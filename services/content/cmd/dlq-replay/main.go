// Command dlq-replay republishes dead letter messages onto their
// original topic so the search worker can index them again.
//
// Run it after an AI outage:
//
//	go run ./cmd/dlq-replay
//
// Environment:
//
//	KAFKA_BROKERS       comma separated brokers (default localhost:9092)
//	KAFKA_DLQ_TOPIC     dead letter topic (default posts-dlq)
//	KAFKA_REPLAY_GROUP  consumer group; resume from committed offset (default content-search-dlq-replay)
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/kunalPisolkar24/topos/services/content/internal/dlq"
)

func main() {
	if err := run(); err != nil {
		slog.Error("dlq replay failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	brokers := splitEnv("KAFKA_BROKERS", "localhost:9092")
	dlqTopic := envOr("KAFKA_DLQ_TOPIC", "posts-dlq")
	groupID := envOr("KAFKA_REPLAY_GROUP", "content-search-dlq-replay")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	replayer := dlq.New(brokers, dlqTopic, groupID)
	defer replayer.Close()

	slog.Info("replaying dead letters", "topic", dlqTopic, "group", groupID)
	count, err := replayer.Run(ctx)
	if err != nil {
		return err
	}

	slog.Info("replay complete", "replayed", count)
	return nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func splitEnv(key, fallback string) []string {
	value := envOr(key, fallback)
	return strings.Split(value, ",")
}
