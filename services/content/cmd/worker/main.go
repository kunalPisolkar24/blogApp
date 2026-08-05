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

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/config"
	"github.com/kunalPisolkar24/topos/services/content/internal/db"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/infrastructure/ai"
	"github.com/kunalPisolkar24/topos/services/content/internal/infrastructure/messaging"
	"github.com/kunalPisolkar24/topos/services/content/internal/observability"
	"github.com/kunalPisolkar24/topos/services/content/internal/repository"
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
	"github.com/kunalPisolkar24/topos/services/content/internal/worker"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

const (
	serviceName     = "content-worker"
	healthTimeout   = 2 * time.Second
	shutdownTimeout = 10 * time.Second
)

func main() {
	if err := run(); err != nil {
		slog.Error("worker terminated with error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg := config.LoadConfig()
	observability.SetupLogging(cfg.LogFormat, cfg.LogLevel, serviceName)

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

	cacheClient, err := cache.New(ctx, cfg.RedisAddr)
	if err != nil {
		slog.Warn("redis unavailable, caching disabled", "addr", cfg.RedisAddr, "error", err)
	} else {
		defer cacheClient.Close()
	}

	aiClient := ai.NewResilientClient(cfg.AIServiceURL)
	defer aiClient.Close()

	producer := messaging.NewKafkaProducer(cfg.KafkaBrokers, cfg.KafkaTopic)
	defer producer.Close()

	processor := service.NewPostService(
		repository.NewMongoPostRepository(mongoClient.Database(cfg.DbName)),
		repository.NewMongoTagRepository(mongoClient.Database(cfg.DbName)),
		aiClient,
		producer,
		cacheClient,
	)

	w, err := worker.NewWorker(
		cfg.KafkaBrokers,
		cfg.KafkaConsumerGroupID,
		[]string{cfg.KafkaTopic},
		cfg.KafkaDLQTopic,
		cfg.WorkerConcurrency,
		processor,
		aiClient,
		producer,
	)
	if err != nil {
		return err
	}
	defer w.Close()

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           newHealthHandler(mongoClient, producer, w),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		slog.Info("worker health server listening", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("health server failed", "error", err)
			stop()
		}
	}()

	go w.Start(ctx)
	slog.Info("worker started", "group", cfg.KafkaConsumerGroupID, "topic", cfg.KafkaTopic, "concurrency", cfg.WorkerConcurrency)

	<-ctx.Done()
	slog.Info("shutting down worker")

	select {
	case <-w.Done():
	case <-time.After(shutdownTimeout):
		slog.Warn("worker did not stop within timeout")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}

// newHealthHandler reports 200 when mongo, kafka and the worker are
// healthy, and serves Prometheus metrics on /metrics.
func newHealthHandler(mongoClient *mongo.Client, producer domain.EventProducer, w *worker.Worker) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/health", func(rw http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), healthTimeout)
		defer cancel()

		checks := []struct {
			name string
			err  error
		}{
			{"mongo", mongoClient.Ping(ctx, readpref.Primary())},
			{"kafka", producer.Ping(ctx)},
			{"worker", w.Running()},
		}

		status := http.StatusOK
		for _, check := range checks {
			if check.err != nil {
				slog.Warn("health check failed", "check", check.name, "error", check.err)
				status = http.StatusServiceUnavailable
			}
		}

		rw.WriteHeader(status)
	})
	return mux
}
