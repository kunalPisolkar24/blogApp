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

func newTestWorker(t *testing.T, processor domain.SummaryProcessor, ai domain.AIService, producer domain.DLQPublisher) *Worker {
	t.Helper()
	return &Worker{
		processor:  processor,
		aiService:  ai,
		producer:   producer,
		dlqTopic:   "dlq",
		maxRetries: maxRetries,
		retryBase:  retryBase,
		done:       make(chan struct{}),
	}
}

func eventMessage(t *testing.T, postID string) kafka.Message {
	t.Helper()
	payload, err := json.Marshal(domain.PostEventPayload{PostID: postID, Body: "event body"})
	require.NoError(t, err)
	return kafka.Message{Key: []byte(postID), Value: payload, Partition: 0, Offset: 1}
}

func TestProcessMessageTombstone(t *testing.T) {
	w := newTestWorker(t, &testutil.MockSummaryProcessor{}, nil, nil)
	require.NoError(t, w.processMessage(context.Background(), kafka.Message{Key: []byte("p_1"), Partition: 0, Offset: 1}))
}

func TestProcessMessageInvalidJSON(t *testing.T) {
	w := newTestWorker(t, &testutil.MockSummaryProcessor{}, nil, nil)
	err := w.processMessage(context.Background(), kafka.Message{Value: []byte("not json")})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unmarshal event")
}

func TestProcessMessageMissingPostID(t *testing.T) {
	w := newTestWorker(t, &testutil.MockSummaryProcessor{}, nil, nil)
	msg := eventMessage(t, "  ")
	err := w.processMessage(context.Background(), msg)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing postId")
}

func TestProcessMessagePostDeleted(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return nil, domain.ErrNotFound
	}}
	w := newTestWorker(t, processor, nil, nil)

	require.NoError(t, w.processMessage(context.Background(), eventMessage(t, "p_gone")))
}

func TestProcessMessageFetchError(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return nil, errors.New("db down")
	}}
	w := newTestWorker(t, processor, nil, nil)

	err := w.processMessage(context.Background(), eventMessage(t, "p_1"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "fetch post")
}

func TestProcessMessageAlreadyCompleted(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, Summary: "done", SummaryStatus: domain.PostStatusCompleted}, nil
	}}
	w := newTestWorker(t, processor, nil, nil)

	require.NoError(t, w.processMessage(context.Background(), eventMessage(t, "p_done")))
}

func TestProcessMessageHappyPath(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, Body: "<p>Hello <b>world</b></p>"}, nil
	}}
	ai := &testutil.MockAIService{GenerateSummaryFn: func(ctx context.Context, text string) (string, error) {
		assert.Equal(t, "Hello world", text, "html must be stripped before summarising")
		return "A summary", nil
	}}
	w := newTestWorker(t, processor, ai, nil)

	require.NoError(t, w.processMessage(context.Background(), eventMessage(t, "p_1")))
	assert.Equal(t, domain.PostStatusCompleted, processor.SummaryStatus)
}

func TestProcessMessageUsesEventBodyWhenPostEmpty(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, Body: "   "}, nil
	}}
	ai := &testutil.MockAIService{GenerateSummaryFn: func(ctx context.Context, text string) (string, error) {
		assert.Equal(t, "event body", text)
		return "S", nil
	}}
	w := newTestWorker(t, processor, ai, nil)

	require.NoError(t, w.processMessage(context.Background(), eventMessage(t, "p_1")))
}

func TestProcessMessageNoUsableBody(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, Body: "<p>  </p>"}, nil
	}}
	w := newTestWorker(t, processor, nil, nil)

	err := w.processMessage(context.Background(), eventMessage(t, "p_1"))
	require.NoError(t, err)
	assert.Equal(t, domain.PostStatusFailed, processor.SummaryStatus)
}

func TestProcessMessageAIErrorMarksFailed(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, Body: "some body text"}, nil
	}}
	ai := &testutil.MockAIService{GenerateSummaryFn: func(ctx context.Context, text string) (string, error) {
		return "", errors.New("ai down")
	}}
	w := newTestWorker(t, processor, ai, nil)

	err := w.processMessage(context.Background(), eventMessage(t, "p_1"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ai down")
	assert.Equal(t, domain.PostStatusFailed, processor.SummaryStatus)
}

func TestProcessMessageEmptyAISummaryMarksFailed(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, Body: "body text"}, nil
	}}
	ai := &testutil.MockAIService{GenerateSummaryFn: func(ctx context.Context, text string) (string, error) {
		return "", nil
	}}
	w := newTestWorker(t, processor, ai, nil)

	err := w.processMessage(context.Background(), eventMessage(t, "p_1"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty summary")
	assert.Equal(t, domain.PostStatusFailed, processor.SummaryStatus, "an empty summary must not be fabricated")
}

func TestProcessMessageCircuitOpenMarksFailed(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, Body: "body text"}, nil
	}}
	ai := &testutil.MockAIService{GenerateSummaryFn: func(ctx context.Context, text string) (string, error) {
		return "", domain.ErrAICircuitOpen
	}}
	w := newTestWorker(t, processor, ai, nil)

	err := w.processMessage(context.Background(), eventMessage(t, "p_1"))
	require.ErrorIs(t, err, domain.ErrAICircuitOpen)
	assert.Equal(t, domain.PostStatusFailed, processor.SummaryStatus)
}

func TestProcessMessageSetSummaryError(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{
		GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return &domain.Post{ID: id, Body: "body text"}, nil
		},
		SetFn: func(ctx context.Context, id, summary string, status domain.PostStatus) error {
			return errors.New("db down")
		},
	}
	ai := &testutil.MockAIService{GenerateSummaryFn: func(ctx context.Context, text string) (string, error) {
		return "S", nil
	}}
	w := newTestWorker(t, processor, ai, nil)

	err := w.processMessage(context.Background(), eventMessage(t, "p_1"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "update post summary")
}

func TestProcessWithRetriesSucceedsFirstAttempt(t *testing.T) {
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, Body: "body text"}, nil
	}}
	ai := &testutil.MockAIService{GenerateSummaryFn: func(ctx context.Context, text string) (string, error) {
		return "A summary", nil
	}}
	w := newTestWorker(t, processor, ai, nil)
	require.NoError(t, w.processWithRetries(context.Background(), &kafka.Reader{}, eventMessage(t, "p_1")))
}

func TestProcessWithRetriesExhaustsAttempts(t *testing.T) {
	attempts := 0
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		attempts++
		return nil, errors.New("boom")
	}}
	w := newTestWorker(t, processor, nil, nil)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), &kafka.Reader{}, eventMessage(t, "p_1"))

	require.Error(t, err)
	assert.Equal(t, maxRetries, attempts, "every retry budget slot must be used before giving up")
}

func TestProcessWithRetriesFailsFastOnPermanentError(t *testing.T) {
	attempts := 0
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		attempts++
		return nil, permanentf("unparseable message")
	}}
	w := newTestWorker(t, processor, nil, nil)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), &kafka.Reader{}, eventMessage(t, "p_1"))

	require.Error(t, err)
	assert.Equal(t, 1, attempts, "permanent errors must not be retried")
}

func TestProcessWithRetriesFailsFastOnCircuitOpen(t *testing.T) {
	attempts := 0
	processor := &testutil.MockSummaryProcessor{GetPostFn: func(ctx context.Context, id string) (*domain.Post, error) {
		attempts++
		return nil, domain.ErrAICircuitOpen
	}}
	w := newTestWorker(t, processor, nil, nil)
	w.retryBase = time.Millisecond

	err := w.processWithRetries(context.Background(), &kafka.Reader{}, eventMessage(t, "p_1"))

	require.ErrorIs(t, err, domain.ErrAICircuitOpen)
	assert.Equal(t, 1, attempts, "an open circuit must not burn the retry backoff")
}

func TestProcessMessagePermanentUnmarshalError(t *testing.T) {
	w := newTestWorker(t, nil, nil, nil)

	err := w.processMessage(context.Background(), kafka.Message{Value: []byte("not json")})

	require.Error(t, err)
	assert.True(t, isPermanent(err), "malformed payloads must be marked permanent")
}

func TestNewWorkerRetryDefaults(t *testing.T) {
	w, err := NewWorker([]string{"localhost:9092"}, "g", []string{"posts"}, "dlq", 1, nil, nil, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	assert.Equal(t, maxRetries, w.maxRetries)
	assert.Equal(t, retryBase, w.retryBase)
}

func TestSendToDLQ(t *testing.T) {
	producer := &testutil.MockEventPublisher{}
	w := newTestWorker(t, nil, nil, producer)

	err := w.sendToDLQ(context.Background(), &kafka.Reader{}, kafka.Message{Topic: "posts", Key: []byte("p_1"), Value: []byte("v")}, errors.New("boom"))
	require.NoError(t, err)
	require.Len(t, producer.DeadLetters, 1)
	assert.Equal(t, "posts", producer.DeadLetters[0].OriginalTopic)
	assert.Equal(t, "dlq", producer.DeadLetters[0].DLQTopic)
	assert.Equal(t, []byte("p_1"), producer.DeadLetters[0].Key)
	assert.Equal(t, "boom", producer.DeadLetters[0].Cause.Error())
}

func TestSendToDLQPublishFailureReturnsError(t *testing.T) {
	producer := &testutil.MockEventPublisher{Err: errors.New("kafka down")}
	w := newTestWorker(t, nil, nil, producer)

	err := w.sendToDLQ(context.Background(), &kafka.Reader{}, kafka.Message{Topic: "posts", Key: []byte("p_1"), Value: []byte("v")}, errors.New("boom"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "kafka down")
}

func TestSendToDLQNilProducer(t *testing.T) {
	w := newTestWorker(t, nil, nil, nil)
	w.sendToDLQ(context.Background(), &kafka.Reader{}, kafka.Message{Key: []byte("k")}, errors.New("boom"))
}

func TestNewWorkerValidation(t *testing.T) {
	_, err := NewWorker(nil, "g", []string{"t"}, "dlq", 1, nil, nil, nil)
	require.Error(t, err)

	_, err = NewWorker([]string{"b"}, " ", []string{"t"}, "dlq", 1, nil, nil, nil)
	require.Error(t, err)

	_, err = NewWorker([]string{"b"}, "g", nil, "dlq", 1, nil, nil, nil)
	require.Error(t, err)
}

func TestNewWorkerConcurrencyFloor(t *testing.T) {
	w, err := NewWorker([]string{"localhost:9092"}, "g", []string{"posts"}, "dlq", 0, nil, nil, nil)
	require.NoError(t, err)
	assert.Len(t, w.readers, 1)
	require.NoError(t, w.Close())
}

func TestStripHTML(t *testing.T) {
	assert.Equal(t, "Hello world", stripHTML("<p>Hello <b>world</b></p>"))
	assert.Equal(t, "a & b", stripHTML("a &amp; b"))
	assert.Equal(t, "", stripHTML(""))
	assert.Equal(t, "", stripHTML("<div>  </div>"))
}

func TestWorkerLifecycle(t *testing.T) {
	// kafka.NewReader connects lazily, so the worker can run without a
	// broker; Start blocks on FetchMessage until the context is cancelled.
	w, err := NewWorker([]string{"localhost:9092"}, "g", []string{"posts"}, "dlq", 1,
		&testutil.MockSummaryProcessor{}, nil, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	assert.Equal(t, "worker is not running", w.Running().Error())

	select {
	case <-w.Done():
		t.Fatal("done must not be closed before Start")
	default:
	}

	ctx, stop := context.WithCancel(context.Background())
	go w.Start(ctx)

	require.Eventually(t, func() bool { return w.Running() == nil }, time.Second, 10*time.Millisecond)
	stop()
	<-w.Done()
	require.Error(t, w.Running())
}

func TestWorkerCloseWithoutReaders(t *testing.T) {
	w := newTestWorker(t, nil, nil, nil)
	require.NoError(t, w.Close())
}
