//go:build integration

package worker

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/infrastructure/messaging"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/segmentio/kafka-go"
	"github.com/stretchr/testify/require"
)

func TestPersonalizerWorkerUpdatesProfileFromInteraction(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := testutil.StartKafka(t, ctx)
	testutil.EnsureTopic(t, ctx, brokers, "user-interacted")
	testutil.EnsureTopic(t, ctx, brokers, "posts-dlq")

	producer := messaging.NewKafkaProducer(brokers, "posts", "user-interacted")
	t.Cleanup(func() { _ = producer.Close() })

	require.NoError(t, producer.PublishUserInteracted(ctx, &domain.PostInteraction{
		UserID: "u_roundtrip",
		PostID: "p_roundtrip",
		Kind:   domain.PostInteractionSave,
	}))

	var calls atomic.Int32
	ai := &testutil.MockAIService{UpdateUserProfileFn: func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) error {
		calls.Add(1)
		require.Equal(t, "u_roundtrip", userID)
		require.Equal(t, "p_roundtrip", postID)
		require.Equal(t, domain.PostInteractionSave, kind)
		return nil
	}}

	// A distinct consumer group proves the personalizer never competes
	// with the summary or search workers for the same events.
	w, err := NewPersonalizerWorker(brokers, "personalizer-test", []string{"user-interacted"}, "posts-dlq", 1, ai, producer)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	workerCtx, stop := context.WithCancel(context.Background())
	defer stop()
	go w.Start(workerCtx)

	require.Eventually(t, func() bool {
		return calls.Load() >= 1
	}, 60*time.Second, 500*time.Millisecond, "interaction should reach the AI service")
}

func TestPersonalizerWorkerRetriesThenDeadLetters(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := testutil.StartKafka(t, ctx)
	testutil.EnsureTopic(t, ctx, brokers, "user-interacted")
	testutil.EnsureTopic(t, ctx, brokers, "posts-dlq")

	producer := messaging.NewKafkaProducer(brokers, "posts", "user-interacted")
	t.Cleanup(func() { _ = producer.Close() })

	require.NoError(t, producer.PublishUserInteracted(ctx, &domain.PostInteraction{
		UserID: "u_fail",
		PostID: "p_fail",
		Kind:   domain.PostInteractionLike,
	}))

	var attempts atomic.Int32
	ai := &testutil.MockAIService{UpdateUserProfileFn: func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) error {
		attempts.Add(1)
		return errors.New("profile update unavailable")
	}}

	w, err := NewPersonalizerWorker(brokers, "personalizer-test", []string{"user-interacted"}, "posts-dlq", 1, ai, producer)
	require.NoError(t, err)
	// Keep the retry backoff short so the test does not wait out the
	// production schedule.
	w.retryBase = 50 * time.Millisecond
	t.Cleanup(func() { _ = w.Close() })

	workerCtx, stop := context.WithCancel(context.Background())
	defer stop()
	go w.Start(workerCtx)

	// The whole retry budget is spent, then the event is dead lettered.
	// At least the budget is spent: if a commit fails mid-rebalance the
	// message is refetched and retried again, so attempts can exceed
	// maxRetries without the worker misbehaving.
	require.Eventually(t, func() bool {
		return attempts.Load() >= int32(maxRetries)
	}, 60*time.Second, 200*time.Millisecond, "ai should be called at least maxRetries times")
	require.Eventually(t, func() bool {
		return interactedDLQHasMessage(t, ctx, brokers, "posts-dlq", "u_fail")
	}, 60*time.Second, 500*time.Millisecond, "failed interaction should reach the dlq after retries")
}

// interactedDLQHasMessage reports whether a message with the given key
// is sitting on the dlq topic, still carrying the user-interacted topic
// in its envelope.
func interactedDLQHasMessage(t *testing.T, ctx context.Context, brokers []string, dlqTopic, key string) bool {
	t.Helper()

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     brokers,
		Topic:       dlqTopic,
		GroupID:     "dlq-check-" + key,
		StartOffset: kafka.FirstOffset,
	})
	defer reader.Close()

	for {
		m, err := reader.FetchMessage(ctx)
		if err != nil {
			return false
		}
		if string(m.Key) == key {
			var payload messaging.DeadLetterMessage
			_ = json.Unmarshal(m.Value, &payload)
			return payload.OriginalTopic == "user-interacted"
		}
	}
}
