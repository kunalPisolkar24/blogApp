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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWorkerConsumesAndSummarises(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := testutil.StartKafka(t, ctx)
	testutil.EnsureTopic(t, ctx, brokers, "posts")
	testutil.EnsureTopic(t, ctx, brokers, "dlq")

	producer := messaging.NewKafkaProducer(brokers, "posts")
	t.Cleanup(func() { _ = producer.Close() })

	post := &domain.Post{ID: "p_e2e", Title: "Hello", Body: "<p>Some body content</p>", SummaryStatus: domain.PostStatusPending}
	require.NoError(t, producer.PublishPostCreated(ctx, post))

	processor := newInMemoryProcessor(post)

	w, err := NewWorker(brokers, "content-worker-test", []string{"posts"}, "dlq", 1,
		processor, &testutil.MockAIService{GenerateSummaryFn: func(ctx context.Context, text string) (string, error) {
			return "Generated summary", nil
		}}, producer)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	workerCtx, stop := context.WithCancel(context.Background())
	defer stop()
	go w.Start(workerCtx)

	require.Eventually(t, func() bool {
		return processor.status["p_e2e"] == domain.PostStatusCompleted &&
			processor.summary["p_e2e"] == "Generated summary"
	}, 60*time.Second, 500*time.Millisecond, "worker should generate and store the summary")
}

func TestWorkerSkipsTombstone(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := testutil.StartKafka(t, ctx)
	testutil.EnsureTopic(t, ctx, brokers, "posts")
	testutil.EnsureTopic(t, ctx, brokers, "dlq")

	producer := messaging.NewKafkaProducer(brokers, "posts")
	t.Cleanup(func() { _ = producer.Close() })

	require.NoError(t, producer.PublishPostDeleted(ctx, "p_gone"))

	processor := newInMemoryProcessor(&domain.Post{ID: "p_gone"})
	w, err := NewWorker(brokers, "content-worker-test", []string{"posts"}, "dlq", 1, processor, nil, producer)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	workerCtx, stop := context.WithCancel(context.Background())
	defer stop()
	go w.Start(workerCtx)

	// Tombstones produce no summaries; give the worker a moment to read.
	time.Sleep(5 * time.Second)
	assert.Empty(t, processor.summary)
}

func TestWorkerSendsPoisonToDLQ(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := testutil.StartKafka(t, ctx)
	testutil.EnsureTopic(t, ctx, brokers, "posts")
	testutil.EnsureTopic(t, ctx, brokers, "dlq")

	producer := messaging.NewKafkaProducer(brokers, "posts")
	t.Cleanup(func() { _ = producer.Close() })

	writer := &kafka.Writer{Addr: kafka.TCP(brokers...), Balancer: &kafka.Hash{}}
	t.Cleanup(func() { _ = writer.Close() })
	require.NoError(t, writer.WriteMessages(ctx, kafka.Message{Topic: "posts", Key: []byte("p_bad"), Value: []byte("not json"), Time: time.Now()}))

	w, err := NewWorker(brokers, "content-worker-test", []string{"posts"}, "dlq", 1,
		newInMemoryProcessor(), nil, producer)
	require.NoError(t, err)
	// The poison message is a permanent failure; keep the retry backoff
	// short so the test does not wait out the production schedule.
	w.retryBase = 50 * time.Millisecond
	t.Cleanup(func() { _ = w.Close() })

	workerCtx, stop := context.WithCancel(context.Background())
	defer stop()
	go w.Start(workerCtx)

	// The worker should land the poison message in the DLQ topic.
	require.Eventually(t, func() bool {
		return dlqHasMessage(t, ctx, brokers, "dlq", "p_bad")
	}, 60*time.Second, 500*time.Millisecond, "poison message should reach the dlq")
}

func TestSearchWorkerRetriesThenDeadLetters(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := testutil.StartKafka(t, ctx)
	testutil.EnsureTopic(t, ctx, brokers, "posts")
	testutil.EnsureTopic(t, ctx, brokers, "posts-dlq")

	producer := messaging.NewKafkaProducer(brokers, "posts")
	t.Cleanup(func() { _ = producer.Close() })

	require.NoError(t, producer.PublishPostCreated(ctx, &domain.Post{ID: "p_retry", Title: "T", Body: "<p>b</p>"}))

	var attempts atomic.Int32
	ai := &testutil.MockAIService{IndexPostFn: func(ctx context.Context, postID, title, body, summary string, tags []string, ts time.Time) error {
		attempts.Add(1)
		return errors.New("index unavailable")
	}}
	w, err := NewSearchWorker(brokers, "search-worker-test", []string{"posts"}, "posts-dlq", 1, ai, producer)
	require.NoError(t, err)
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
		return dlqHasMessage(t, ctx, brokers, "posts-dlq", "p_retry")
	}, 60*time.Second, 500*time.Millisecond, "failed event should reach the dlq after retries")
}

// inMemoryProcessor stands in for the post store; it records summaries
// and statuses the way mongo would.
type inMemoryProcessor struct {
	posts   map[string]*domain.Post
	status  map[string]domain.PostStatus
	summary map[string]string
}

func newInMemoryProcessor(posts ...*domain.Post) *inMemoryProcessor {
	p := &inMemoryProcessor{
		posts:   map[string]*domain.Post{},
		status:  map[string]domain.PostStatus{},
		summary: map[string]string{},
	}
	for _, post := range posts {
		p.posts[post.ID] = post
	}
	return p
}

func (p *inMemoryProcessor) GetPost(ctx context.Context, id string) (*domain.Post, error) {
	post, ok := p.posts[id]
	if !ok {
		return nil, domain.ErrNotFound
	}
	return post, nil
}

func (p *inMemoryProcessor) SetPostSummary(ctx context.Context, id, summary string, status domain.PostStatus) error {
	p.summary[id] = summary
	p.status[id] = status
	return nil
}

// dlqHasMessage reports whether a message with the given key is sitting
// on the dlq topic, still carrying the original topic in its envelope.
func dlqHasMessage(t *testing.T, ctx context.Context, brokers []string, dlqTopic, key string) bool {
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
			return payload.OriginalTopic == "posts"
		}
	}
}
