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

func newTestSearchWorker(t *testing.T, ai domain.AIService) *SearchWorker {
	t.Helper()
	return &SearchWorker{
		aiService:  ai,
		dlqTopic:   "dlq",
		maxRetries: maxRetries,
		retryBase:  retryBase,
		done:       make(chan struct{}),
	}
}

func searchEventMessage(t *testing.T, payload domain.PostEventPayload) kafka.Message {
	t.Helper()
	value, err := json.Marshal(payload)
	require.NoError(t, err)
	return kafka.Message{Key: []byte(payload.PostID), Value: value, Partition: 0, Offset: 1}
}

func TestSearchProcessMessageIndexesPost(t *testing.T) {
	createdAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	ai := &testutil.MockAIService{IndexPostFn: func(ctx context.Context, postID, title, body, summary string, tags []string, ts time.Time) error {
		assert.Equal(t, "p_1", postID)
		assert.Equal(t, "Title", title)
		assert.Equal(t, "Body", body)
		assert.Equal(t, "Summary", summary)
		assert.Equal(t, []string{"grpc", "tutorial"}, tags)
		assert.Equal(t, createdAt, ts)
		return nil
	}}
	w := newTestSearchWorker(t, ai)

	msg := searchEventMessage(t, domain.PostEventPayload{
		PostID:    "p_1",
		Title:     "Title",
		Body:      "Body",
		Summary:   "Summary",
		Tags:      []string{"grpc", "tutorial"},
		CreatedAt: createdAt,
	})

	require.NoError(t, w.processMessage(context.Background(), msg))
}

func TestSearchProcessMessageTombstoneDeletesPost(t *testing.T) {
	ai := &testutil.MockAIService{DeletePostFn: func(ctx context.Context, postID string) error {
		assert.Equal(t, "p_1", postID)
		return nil
	}}
	w := newTestSearchWorker(t, ai)

	err := w.processMessage(context.Background(), kafka.Message{Key: []byte("p_1"), Partition: 0, Offset: 1})
	require.NoError(t, err)
}

func TestSearchProcessMessageTombstoneWithoutKey(t *testing.T) {
	w := newTestSearchWorker(t, &testutil.MockAIService{})

	err := w.processMessage(context.Background(), kafka.Message{Partition: 0, Offset: 1})
	require.NoError(t, err)
}

func TestSearchProcessMessageIndexError(t *testing.T) {
	ai := &testutil.MockAIService{IndexPostFn: func(ctx context.Context, postID, title, body, summary string, tags []string, ts time.Time) error {
		return errors.New("ai down")
	}}
	w := newTestSearchWorker(t, ai)

	err := w.processMessage(context.Background(), searchEventMessage(t, domain.PostEventPayload{PostID: "p_1"}))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "index post")
}

func TestSearchProcessMessageDeleteError(t *testing.T) {
	ai := &testutil.MockAIService{DeletePostFn: func(ctx context.Context, postID string) error {
		return errors.New("ai down")
	}}
	w := newTestSearchWorker(t, ai)

	err := w.processMessage(context.Background(), kafka.Message{Key: []byte("p_1"), Partition: 0, Offset: 1})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "delete post from index")
}

func TestSearchProcessMessageInvalidJSON(t *testing.T) {
	w := newTestSearchWorker(t, &testutil.MockAIService{})

	err := w.processMessage(context.Background(), kafka.Message{Value: []byte("not json")})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unmarshal event")
}

func TestSearchProcessMessageMissingPostID(t *testing.T) {
	w := newTestSearchWorker(t, &testutil.MockAIService{})

	err := w.processMessage(context.Background(), searchEventMessage(t, domain.PostEventPayload{}))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing postId")
}

func TestSearchProcessWithRetriesExhaustsAttempts(t *testing.T) {
	attempts := 0
	ai := &testutil.MockAIService{IndexPostFn: func(ctx context.Context, postID, title, body, summary string, tags []string, ts time.Time) error {
		attempts++
		return errors.New("boom")
	}}
	w := newTestSearchWorker(t, ai)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), searchEventMessage(t, domain.PostEventPayload{PostID: "p_1"}))

	require.Error(t, err)
	assert.Equal(t, maxRetries, attempts, "every retry budget slot must be used before giving up")
}

func TestSearchProcessWithRetriesRecovers(t *testing.T) {
	attempts := 0
	ai := &testutil.MockAIService{IndexPostFn: func(ctx context.Context, postID, title, body, summary string, tags []string, ts time.Time) error {
		attempts++
		if attempts < 3 {
			return errors.New("boom")
		}
		return nil
	}}
	w := newTestSearchWorker(t, ai)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), searchEventMessage(t, domain.PostEventPayload{PostID: "p_1"}))

	require.NoError(t, err)
	assert.Equal(t, 3, attempts)
}

func TestSearchProcessWithRetriesFailsFastOnPermanentError(t *testing.T) {
	attempts := 0
	ai := &testutil.MockAIService{IndexPostFn: func(ctx context.Context, postID, title, body, summary string, tags []string, ts time.Time) error {
		attempts++
		return permanentf("unparseable message")
	}}
	w := newTestSearchWorker(t, ai)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), searchEventMessage(t, domain.PostEventPayload{PostID: "p_1"}))

	require.Error(t, err)
	assert.Equal(t, 1, attempts, "permanent errors must not be retried")
}

func TestSearchProcessWithRetriesFailsFastOnCircuitOpen(t *testing.T) {
	attempts := 0
	ai := &testutil.MockAIService{IndexPostFn: func(ctx context.Context, postID, title, body, summary string, tags []string, ts time.Time) error {
		attempts++
		return domain.ErrAICircuitOpen
	}}
	w := newTestSearchWorker(t, ai)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), searchEventMessage(t, domain.PostEventPayload{PostID: "p_1"}))

	require.ErrorIs(t, err, domain.ErrAICircuitOpen)
	assert.Equal(t, 1, attempts, "an open circuit must not burn the retry backoff")
}

func TestNewSearchWorkerRetryDefaults(t *testing.T) {
	w, err := NewSearchWorker([]string{"localhost:9092"}, "g", []string{"posts"}, "dlq", 1, nil, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	assert.Equal(t, maxRetries, w.maxRetries)
	assert.Equal(t, retryBase, w.retryBase)
}

func TestSearchSendToDLQ(t *testing.T) {
	producer := &testutil.MockEventPublisher{}
	w := newTestSearchWorker(t, nil)
	w.producer = producer

	w.sendToDLQ(context.Background(), kafka.Message{Topic: "posts", Key: []byte("p_1"), Value: []byte("v")}, errors.New("boom"))
	require.Len(t, producer.DeadLetters, 1)
	assert.Equal(t, "dlq", producer.DeadLetters[0].DLQTopic)
	assert.Equal(t, "boom", producer.DeadLetters[0].Cause.Error())
}

func TestNewSearchWorkerValidation(t *testing.T) {
	_, err := NewSearchWorker(nil, "g", []string{"t"}, "dlq", 1, nil, nil)
	require.Error(t, err)

	_, err = NewSearchWorker([]string{"b"}, " ", []string{"t"}, "dlq", 1, nil, nil)
	require.Error(t, err)

	_, err = NewSearchWorker([]string{"b"}, "g", nil, "dlq", 1, nil, nil)
	require.Error(t, err)
}

func TestNewSearchWorkerConcurrencyFloor(t *testing.T) {
	w, err := NewSearchWorker([]string{"localhost:9092"}, "g", []string{"posts"}, "dlq", 0, nil, nil)
	require.NoError(t, err)
	assert.Len(t, w.readers, 1)
	require.NoError(t, w.Close())
}

func TestSearchWorkerLifecycle(t *testing.T) {
	w, err := NewSearchWorker([]string{"localhost:9092"}, "g", []string{"posts"}, "dlq", 1, nil, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	assert.Equal(t, "search worker is not running", w.Running().Error())

	ctx, stop := context.WithCancel(context.Background())
	go w.Start(ctx)

	require.Eventually(t, func() bool { return w.Running() == nil }, time.Second, 10*time.Millisecond)
	stop()
	<-w.Done()
	require.Error(t, w.Running())
}
