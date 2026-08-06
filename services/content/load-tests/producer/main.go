package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/segmentio/kafka-go"
)

func main() {
	brokers := []string{getenv("BROKERS", "kafka-1:9092")}
	topic := getenv("TOPIC", "posts")
	rps := getInt("RPS", 50)
	duration := getDuration("DURATION", 30*time.Second)

	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.Hash{},
		BatchSize:    1,
		RequiredAcks: kafka.RequireAll,
	}
	defer w.Close()

	slog.Info("producer starting", "brokers", brokers, "topic", topic, "rps", rps, "duration", duration)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	tick := time.NewTicker(time.Second / time.Duration(rps))
	defer tick.Stop()

	sent, errors := 0, 0
	deadline := time.After(duration)

	for {
		select {
		case <-tick.C:
			if err := publish(ctx, w, topic, sent); err != nil {
				errors++
				if errors <= 3 {
					slog.Error("publish failed", "error", err)
				}
			} else {
				sent++
			}
		case <-deadline:
			slog.Info("producer finished", "sent", sent, "errors", errors)
			return
		case <-ctx.Done():
			slog.Info("producer interrupted", "sent", sent, "errors", errors)
			return
		}
	}
}

// publish sends one event for post lt-<n>. Every 20th event is a tombstone
// (nil value), which the worker skips, exercising that path too.
func publish(ctx context.Context, w *kafka.Writer, topic string, n int) error {
	key := fmt.Sprintf("lt-%d", n)

	if n%20 == 0 {
		return w.WriteMessages(ctx, kafka.Message{Topic: topic, Key: []byte(key)})
	}

	payload := fmt.Sprintf(
		`{"postId":%q,"title":%q,"body":%q,"summaryStatus":"pending","createdAt":%q}`,
		key,
		"Load Test Article "+strconv.Itoa(n),
		"<p>Produced by the worker load test.</p>",
		time.Now().UTC().Format(time.RFC3339),
	)

	return w.WriteMessages(ctx, kafka.Message{Topic: topic, Key: []byte(key), Value: []byte(payload), Time: time.Now()})
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
