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

	"github.com/kunalPisolkar24/topos/services/content/internal/bootstrap"
	"github.com/kunalPisolkar24/topos/services/content/internal/config"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
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

	deps, err := bootstrap.New(ctx, cfg, serviceName)
	if err != nil {
		return err
	}
	defer deps.Close(context.Background())

	processor := service.NewPostService(
		repository.NewMongoPostRepository(deps.Mongo.Database(cfg.DbName)),
		repository.NewMongoTagRepository(deps.Mongo.Database(cfg.DbName)),
		deps.AI,
		deps.Producer,
		deps.Cache,
	)

	w, err := worker.NewWorker(
		cfg.KafkaBrokers,
		cfg.KafkaConsumerGroupID,
		[]string{cfg.KafkaTopic},
		cfg.KafkaDLQTopic,
		cfg.WorkerConcurrency,
		processor,
		deps.AI,
		deps.Producer,
	)
	if err != nil {
		return err
	}
	defer w.Close()

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           newHealthHandler(deps.Mongo, deps.Producer, w),
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

// newHealthHandler reports 200 when mongo, kafka, the worker loop and
// the AI service are healthy, and serves Prometheus metrics on /metrics.
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
			{"ai", w.Healthy(ctx)},
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
