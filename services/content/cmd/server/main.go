package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/kunalPisolkar24/topos/services/content/graph"
	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/config"
	"github.com/kunalPisolkar24/topos/services/content/internal/db"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/infrastructure/ai"
	"github.com/kunalPisolkar24/topos/services/content/internal/infrastructure/messaging"
	"github.com/kunalPisolkar24/topos/services/content/internal/middleware"
	"github.com/kunalPisolkar24/topos/services/content/internal/observability"
	"github.com/kunalPisolkar24/topos/services/content/internal/repository"
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/readpref"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

const (
	serviceName     = "content-service"
	queryPath       = "/query"
	shutdownTimeout = 10 * time.Second
	healthTimeout   = 2 * time.Second
)

func main() {
	if err := run(); err != nil {
		slog.Error("server terminated with error", "error", err)
		os.Exit(1)
	}
}

// run wires everything together and blocks until the server stops.
func run() error {
	cfg := config.LoadConfig()
	observability.SetupLogging(cfg.LogFormat, cfg.LogLevel, serviceName)
	if cfg.JwtSecret == "" {
		return errors.New("JWT_SECRET is required")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownTracing, err := observability.SetupTracing(ctx, cfg.OtelEndpoint, serviceName)
	if err != nil {
		return errors.New("setup tracing: " + err.Error())
	}
	defer shutdownTracing(context.Background())

	mongoClient, err := db.Connect(ctx, cfg.MongoURI)
	if err != nil {
		return errors.New("connect mongo: " + err.Error())
	}
	slog.Info("connected to mongo", "db", cfg.DbName)
	defer mongoClient.Disconnect(ctx)

	if err := db.EnsureIndexes(ctx, mongoClient.Database(cfg.DbName)); err != nil {
		return errors.New("ensure indexes: " + err.Error())
	}
	slog.Info("mongo indexes ready")

	cacheClient, err := cache.New(ctx, cfg.RedisAddr)
	if err != nil {
		slog.Warn("redis unavailable, caching disabled", "addr", cfg.RedisAddr, "error", err)
	} else {
		slog.Info("connected to redis", "addr", cfg.RedisAddr)
		defer cacheClient.Close()
	}

	aiClient := ai.NewResilientClient(cfg.AIServiceURL)
	defer aiClient.Close()
	slog.Info("ai client configured", "addr", cfg.AIServiceURL)

	producer := messaging.NewKafkaProducer(cfg.KafkaBrokers, cfg.KafkaTopic)
	defer producer.Close()

	return serve(ctx, newServer(cfg, newResolver(cfg, mongoClient, cacheClient, aiClient, producer), mongoClient, producer))
}

// newResolver builds the services and graph resolver used by the API.
func newResolver(cfg config.Config, mongoClient *mongo.Client, cacheClient *cache.Cache, aiClient domain.AIService, producer domain.EventPublisher) *graph.Resolver {
	database := mongoClient.Database(cfg.DbName)
	postRepo := repository.NewMongoPostRepository(database)
	tagRepo := repository.NewMongoTagRepository(database)

	return graph.NewResolver(
		service.NewPostService(postRepo, tagRepo, aiClient, producer, cacheClient),
		service.NewTagService(tagRepo, cacheClient),
	)
}

// newHandler wires the GraphQL endpoint, the playground, and the health
// check. The /query handler is traced (span covers auth, resolution and
// outbound calls); every request carries a request id in its context.
func newHandler(cfg config.Config, resolver *graph.Resolver, mongoClient *mongo.Client, producer domain.EventProducer) http.Handler {
	gql := handler.NewDefaultServer(graph.NewExecutableSchema(graph.Config{Resolvers: resolver}))

	mux := http.NewServeMux()
	mux.Handle(queryPath, otelhttp.NewHandler(
		middleware.MetricsMiddleware(middleware.AuthMiddleware(cfg)(gql)),
		"graphql",
	))
	mux.Handle("/", playground.Handler("GraphQL playground", queryPath))
	mux.HandleFunc("/health", healthHandler(mongoClient, producer))
	mux.Handle("/metrics", promhttp.Handler())
	return middleware.RequestIDMiddleware(mux)
}

// pinger abstracts the mongo connectivity check so tests can fake it.
type pinger interface {
	Ping(ctx context.Context, rp *readpref.ReadPref) error
}

// healthHandler reports 200 when mongo and kafka are reachable.
func healthHandler(p pinger, producer domain.EventProducer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), healthTimeout)
		defer cancel()

		if err := p.Ping(ctx, readpref.Primary()); err != nil {
			http.Error(w, "mongo unreachable", http.StatusServiceUnavailable)
			return
		}
		if err := producer.Ping(ctx); err != nil {
			http.Error(w, "kafka unreachable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

// newServer builds the HTTP server with routes attached.
func newServer(cfg config.Config, resolver *graph.Resolver, mongoClient *mongo.Client, producer domain.EventProducer) *http.Server {
	return &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           newHandler(cfg, resolver, mongoClient, producer),
		ReadHeaderTimeout: 5 * time.Second,
	}
}

// serve runs the server until it errors or ctx is cancelled, then shuts down gracefully.
func serve(ctx context.Context, srv *http.Server) error {
	errCh := make(chan error, 1)
	go func() {
		slog.Info("content service listening", "addr", srv.Addr, "playground", queryPath)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
