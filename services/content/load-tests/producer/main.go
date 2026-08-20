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
	interactions := topic == "user-interacted"
	rps := getInt("RPS", 50)
	duration := getDuration("DURATION", 30*time.Second)

	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.Hash{},
		BatchSize:    1,
		RequiredAcks: kafka.RequireAll,
	}
	defer w.Close()

	slog.Info("producer starting", "brokers", brokers, "topic", topic, "interactions", interactions, "rps", rps, "duration", duration)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	tick := time.NewTicker(time.Second / time.Duration(rps))
	defer tick.Stop()

	sent, errors := 0, 0
	deadline := time.After(duration)

	for {
		select {
		case <-tick.C:
			if err := publish(ctx, w, topic, interactions, sent); err != nil {
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

// publish sends one event for post <n>. Every 20th event is a tombstone
// (nil value), which the workers skip, exercising that path too. The post ID
// is a 24-hex-digit string so the AI service can use it as a vector point id.
func publish(ctx context.Context, w *kafka.Writer, topic string, interactions bool, n int) error {
	key := fmt.Sprintf("%024x", n)

	if n%20 == 0 {
		return w.WriteMessages(ctx, kafka.Message{Topic: topic, Key: []byte(key)})
	}

	if interactions {
		return publishInteraction(ctx, w, topic, n, key)
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

// publishInteraction sends one user.interacted event for post <n>, keyed
// by user id so all of a user's interactions stay on one partition,
// mirroring the production publisher. Views are the common case, likes
// stronger and saves the strongest signal.
func publishInteraction(ctx context.Context, w *kafka.Writer, topic string, n int, postID string) error {
	userID := fmt.Sprintf("user-%06d", n)
	kind, weight := "view", 1
	switch {
	case n%10 == 0:
		kind, weight = "save", 5
	case n%5 == 0:
		kind, weight = "like", 3
	}

	payload := fmt.Sprintf(
		`{"userId":%q,"postId":%q,"kind":%q,"weight":%d}`,
		userID, postID, kind, weight,
	)

	return w.WriteMessages(ctx, kafka.Message{Topic: topic, Key: []byte(userID), Value: []byte(payload), Time: time.Now()})
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
