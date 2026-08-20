package worker

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/segmentio/kafka-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestPersonalizerWorker(t *testing.T, ai domain.AIService) *PersonalizerWorker {
	t.Helper()
	return &PersonalizerWorker{
		aiService:  ai,
		dlqTopic:   "dlq",
		maxRetries: maxRetries,
		retryBase:  retryBase,
		done:       make(chan struct{}),
	}
}

func interactionMessage(t *testing.T, payload domain.UserInteractedPayload) kafka.Message {
	t.Helper()
	value, err := json.Marshal(payload)
	require.NoError(t, err)
	return kafka.Message{Key: []byte(payload.UserID), Value: value, Partition: 0, Offset: 1}
}

func TestPersonalizerProcessMessageUpdatesProfile(t *testing.T) {
	ai := &testutil.MockAIService{UpdateUserProfileFn: func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) error {
		assert.Equal(t, "u_1", userID)
		assert.Equal(t, "p_1", postID)
		assert.Equal(t, domain.PostInteractionLike, kind)
		return nil
	}}
	w := newTestPersonalizerWorker(t, ai)

	err := w.processMessage(context.Background(), interactionMessage(t, domain.UserInteractedPayload{
		UserID: "u_1",
		PostID: "p_1",
		Kind:   domain.PostInteractionLike,
	}))

	require.NoError(t, err)
}

func TestPersonalizerProcessMessageSkipsTombstone(t *testing.T) {
	ai := &testutil.MockAIService{}
	w := newTestPersonalizerWorker(t, ai)

	err := w.processMessage(context.Background(), kafka.Message{Key: []byte("u_1"), Partition: 0, Offset: 1})

	require.NoError(t, err)
}

func TestPersonalizerProcessMessageInvalidJSON(t *testing.T) {
	w := newTestPersonalizerWorker(t, &testutil.MockAIService{})

	err := w.processMessage(context.Background(), kafka.Message{Value: []byte("not json")})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "unmarshal interaction")
}

func TestPersonalizerProcessMessageMissingFields(t *testing.T) {
	w := newTestPersonalizerWorker(t, &testutil.MockAIService{})

	err := w.processMessage(context.Background(), interactionMessage(t, domain.UserInteractedPayload{UserID: "u_1"}))

	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing userId or postId")
}

func TestPersonalizerProcessMessageAIError(t *testing.T) {
	ai := &testutil.MockAIService{UpdateUserProfileFn: func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) error {
		return errors.New("ai down")
	}}
	w := newTestPersonalizerWorker(t, ai)

	err := w.processMessage(context.Background(), interactionMessage(t, domain.UserInteractedPayload{
		UserID: "u_1",
		PostID: "p_1",
		Kind:   domain.PostInteractionView,
	}))

	require.Error(t, err)
	assert.Contains(t, err.Error(), "update user profile")
}

func TestPersonalizerProcessWithRetriesExhaustsAttempts(t *testing.T) {
	attempts := 0
	ai := &testutil.MockAIService{UpdateUserProfileFn: func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) error {
		attempts++
		return errors.New("boom")
	}}
	w := newTestPersonalizerWorker(t, ai)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), interactionMessage(t, domain.UserInteractedPayload{
		UserID: "u_1",
		PostID: "p_1",
	}))

	require.Error(t, err)
	assert.Equal(t, maxRetries, attempts, "every retry budget slot must be used before giving up")
}

func TestPersonalizerProcessWithRetriesRecovers(t *testing.T) {
	attempts := 0
	ai := &testutil.MockAIService{UpdateUserProfileFn: func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) error {
		attempts++
		if attempts < 3 {
			return errors.New("boom")
		}
		return nil
	}}
	w := newTestPersonalizerWorker(t, ai)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), interactionMessage(t, domain.UserInteractedPayload{
		UserID: "u_1",
		PostID: "p_1",
	}))

	require.NoError(t, err)
	assert.Equal(t, 3, attempts)
}

func TestPersonalizerProcessWithRetriesFailsFastOnPermanentError(t *testing.T) {
	attempts := 0
	ai := &testutil.MockAIService{UpdateUserProfileFn: func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) error {
		attempts++
		return permanentf("unparseable message")
	}}
	w := newTestPersonalizerWorker(t, ai)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), interactionMessage(t, domain.UserInteractedPayload{
		UserID: "u_1",
		PostID: "p_1",
	}))

	require.Error(t, err)
	assert.Equal(t, 1, attempts, "permanent errors must not be retried")
}

func TestPersonalizerProcessWithRetriesFailsFastOnCircuitOpen(t *testing.T) {
	attempts := 0
	ai := &testutil.MockAIService{UpdateUserProfileFn: func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) error {
		attempts++
		return domain.ErrAICircuitOpen
	}}
	w := newTestPersonalizerWorker(t, ai)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), interactionMessage(t, domain.UserInteractedPayload{
		UserID: "u_1",
		PostID: "p_1",
	}))

	require.ErrorIs(t, err, domain.ErrAICircuitOpen)
	assert.Equal(t, 1, attempts, "an open circuit must not burn the retry backoff")
}

func TestNewPersonalizerWorkerRetryDefaults(t *testing.T) {
	w, err := NewPersonalizerWorker([]string{"localhost:9092"}, "g", []string{"user-interacted"}, "dlq", 1, nil, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	assert.Equal(t, maxRetries, w.maxRetries)
	assert.Equal(t, retryBase, w.retryBase)
}

func TestPersonalizerSendToDLQ(t *testing.T) {
	producer := &testutil.MockEventPublisher{}
	w := newTestPersonalizerWorker(t, nil)
	w.producer = producer

	w.sendToDLQ(context.Background(), kafka.Message{Topic: "user-interacted", Key: []byte("u_1"), Value: []byte("v")}, errors.New("boom"))
	require.Len(t, producer.DeadLetters, 1)
	assert.Equal(t, "dlq", producer.DeadLetters[0].DLQTopic)
	assert.Equal(t, "user-interacted", producer.DeadLetters[0].OriginalTopic)
	assert.Equal(t, "boom", producer.DeadLetters[0].Cause.Error())
}

func TestNewPersonalizerWorkerValidation(t *testing.T) {
	_, err := NewPersonalizerWorker(nil, "g", []string{"t"}, "dlq", 1, nil, nil)
	require.Error(t, err)

	_, err = NewPersonalizerWorker([]string{"b"}, " ", []string{"t"}, "dlq", 1, nil, nil)
	require.Error(t, err)

	_, err = NewPersonalizerWorker([]string{"b"}, "g", nil, "dlq", 1, nil, nil)
	require.Error(t, err)
}

func TestNewPersonalizerWorkerConcurrencyFloor(t *testing.T) {
	w, err := NewPersonalizerWorker([]string{"localhost:9092"}, "g", []string{"user-interacted"}, "dlq", 0, nil, nil)
	require.NoError(t, err)
	assert.Len(t, w.readers, 1)
	require.NoError(t, w.Close())
}

func TestPersonalizerWorkerLifecycle(t *testing.T) {
	w, err := NewPersonalizerWorker([]string{"localhost:9092"}, "g", []string{"user-interacted"}, "dlq", 1, nil, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	assert.Equal(t, "personalizer worker is not running", w.Running().Error())

	ctx, stop := context.WithCancel(context.Background())
	go w.Start(ctx)

	require.Eventually(t, func() bool { return w.Running() == nil }, time.Second, 10*time.Millisecond)
	stop()
	<-w.Done()
	require.Error(t, w.Running())
}

func TestPersonalizerWorkerHealthyWhenRunningAndAIUp(t *testing.T) {
	ai := &testutil.MockAIService{}
	w := newTestPersonalizerWorker(t, ai)
	w.running.Store(true)

	require.NoError(t, w.Healthy(context.Background()))
}

func TestPersonalizerWorkerUnhealthyWhenAIUnavailable(t *testing.T) {
	aiErr := errors.New("ai breaker open: profile")
	ai := &testutil.MockAIService{
		HealthyFn: func(ctx context.Context) error { return aiErr },
	}
	w := newTestPersonalizerWorker(t, ai)
	w.running.Store(true)

	assert.ErrorIs(t, w.Healthy(context.Background()), aiErr)
}

func TestPersonalizerWorkerUnhealthyWhenNotRunning(t *testing.T) {
	w := newTestPersonalizerWorker(t, &testutil.MockAIService{})

	err := w.Healthy(context.Background())

	assert.ErrorContains(t, err, "not running")
}
