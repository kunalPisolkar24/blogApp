// Package bootstrap wires the shared infrastructure dependencies for the
// API and the worker: tracing, mongo, redis, the AI client and Kafka.
package bootstrap

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/config"
	"github.com/kunalPisolkar24/topos/services/content/internal/db"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/infrastructure/ai"
	"github.com/kunalPisolkar24/topos/services/content/internal/infrastructure/messaging"
	"github.com/kunalPisolkar24/topos/services/content/internal/observability"
	"go.mongodb.org/mongo-driver/mongo"
)

// Dependencies holds the shared infrastructure used by the services.
// Cache is nil when redis is unavailable; every other field is required.
type Dependencies struct {
	Mongo           *mongo.Client
	Cache           *cache.Cache
	AI              domain.AIService
	Producer        domain.EventProducer
	ShutdownTracing func(context.Context) error
}

// New connects to mongo, redis, the AI service and Kafka, and wires the
// OpenTelemetry SDK. A redis failure only disables caching; any other
// failure aborts startup.
func New(ctx context.Context, cfg config.Config, serviceName string) (*Dependencies, error) {
	shutdownTracing, err := observability.SetupTracing(ctx, cfg.OtelEndpoint, serviceName)
	if err != nil {
		return nil, fmt.Errorf("setup tracing: %w", err)
	}

	mongoClient, err := db.Connect(ctx, cfg.MongoURI)
	if err != nil {
		shutdownTracing(context.Background())
		return nil, fmt.Errorf("connect mongo: %w", err)
	}
	slog.Info("connected to mongo", "db", cfg.DbName)

	if err := db.EnsureIndexes(ctx, mongoClient.Database(cfg.DbName)); err != nil {
		_ = mongoClient.Disconnect(ctx)
		shutdownTracing(context.Background())
		return nil, fmt.Errorf("ensure indexes: %w", err)
	}
	slog.Info("mongo indexes ready")

	var cacheClient *cache.Cache
	if cacheClient, err = cache.New(ctx, cfg.RedisAddr); err != nil {
		slog.Warn("redis unavailable, caching disabled", "addr", cfg.RedisAddr, "error", err)
	} else {
		slog.Info("connected to redis", "addr", cfg.RedisAddr)
	}

	aiClient := ai.NewResilientClient(cfg.AIServiceURL)
	slog.Info("ai client configured", "addr", cfg.AIServiceURL)

	producer := messaging.NewKafkaProducer(cfg.KafkaBrokers, cfg.KafkaTopic)

	return &Dependencies{
		Mongo:           mongoClient,
		Cache:           cacheClient,
		AI:              aiClient,
		Producer:        producer,
		ShutdownTracing: shutdownTracing,
	}, nil
}

// Close shuts down every dependency in reverse order of creation. It is
// nil-safe so it can always be deferred.
func (d *Dependencies) Close(ctx context.Context) {
	if d.Producer != nil {
		_ = d.Producer.Close()
	}
	if d.AI != nil {
		_ = d.AI.Close()
	}
	if d.Cache != nil {
		_ = d.Cache.Close()
	}
	if d.Mongo != nil {
		_ = d.Mongo.Disconnect(ctx)
	}
	if d.ShutdownTracing != nil {
		_ = d.ShutdownTracing(ctx)
	}
}
