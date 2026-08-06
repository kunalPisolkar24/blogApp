//go:build integration

package messaging

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/kunalPisolkar24/topos/services/content/internal/worker"
	"github.com/segmentio/kafka-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"strconv"

	"github.com/testcontainers/testcontainers-go"
	tckafka "github.com/testcontainers/testcontainers-go/modules/kafka"
	"github.com/testcontainers/testcontainers-go/wait"
)

func startKafka(t *testing.T, ctx context.Context) []string {
	t.Helper()

	container, err := tckafka.RunContainer(ctx,
		tckafka.WithClusterID("test-cluster"),
		testcontainers.WithWaitStrategy(wait.ForLog("started (kafka.server.KafkaRaftServer)").WithStartupTimeout(2*time.Minute)),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	brokers, err := container.Brokers(ctx)
	require.NoError(t, err)
	require.NotEmpty(t, brokers)
	return brokers
}

func ensureTopic(t *testing.T, ctx context.Context, brokers []string, topic string) {
	t.Helper()

	conn, err := kafka.DialContext(ctx, "tcp", brokers[0])
	require.NoError(t, err)
	defer conn.Close()

	controller, err := conn.Controller()
	require.NoError(t, err)

	controllerConn, err := kafka.DialContext(ctx, "tcp", controller.Host+":"+strconv.Itoa(controller.Port))
	require.NoError(t, err)
	defer controllerConn.Close()

	err = controllerConn.CreateTopics(kafka.TopicConfig{Topic: topic, NumPartitions: 1, ReplicationFactor: 1})
	require.NoError(t, err)
}

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

func TestWorkerConsumesAndSummarises(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := startKafka(t, ctx)
	ensureTopic(t, ctx, brokers, "posts")
	ensureTopic(t, ctx, brokers, "dlq")

	producer := NewKafkaProducer(brokers, "posts")
	t.Cleanup(func() { _ = producer.Close() })

	post := &domain.Post{ID: "p_e2e", Title: "Hello", Body: "<p>Some body content</p>", SummaryStatus: domain.PostStatusPending}
	require.NoError(t, producer.PublishPostCreated(ctx, post))

	processor := newInMemoryProcessor(post)

	w, err := worker.NewWorker(brokers, "content-worker-test", []string{"posts"}, "dlq", 1,
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
	}, 30*time.Second, 500*time.Millisecond, "worker should generate and store the summary")
}

func TestWorkerSkipsTombstone(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := startKafka(t, ctx)
	ensureTopic(t, ctx, brokers, "posts")
	ensureTopic(t, ctx, brokers, "dlq")

	producer := NewKafkaProducer(brokers, "posts")
	t.Cleanup(func() { _ = producer.Close() })

	require.NoError(t, producer.PublishPostDeleted(ctx, "p_gone"))

	processor := newInMemoryProcessor(&domain.Post{ID: "p_gone"})
	w, err := worker.NewWorker(brokers, "content-worker-test", []string{"posts"}, "dlq", 1, processor, nil, producer)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	workerCtx, stop := context.WithCancel(context.Background())
	defer stop()
	go w.Start(workerCtx)

	// Tombstones produce no summaries; give the worker a moment to read.
	time.Sleep(3 * time.Second)
	assert.Empty(t, processor.summary)
}

func TestWorkerSendsPoisonToDLQ(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := startKafka(t, ctx)
	ensureTopic(t, ctx, brokers, "posts")
	ensureTopic(t, ctx, brokers, "dlq")

	producer := NewKafkaProducer(brokers, "posts")
	t.Cleanup(func() { _ = producer.Close() })

	require.NoError(t, producer.(*kafkaProducer).writeMessages(ctx, kafka.Message{
		Topic: "posts", Key: []byte("p_bad"), Value: []byte("not json"), Time: time.Now(),
	}))

	w, err := worker.NewWorker(brokers, "content-worker-test", []string{"posts"}, "dlq", 1,
		newInMemoryProcessor(), nil, producer)
	require.NoError(t, err)
	t.Cleanup(func() { _ = w.Close() })

	workerCtx, stop := context.WithCancel(context.Background())
	defer stop()
	go w.Start(workerCtx)

	// The worker should land the poison message in the DLQ topic.
	require.Eventually(t, func() bool {
		return dlqHasMessage(t, ctx, brokers, "p_bad")
	}, 30*time.Second, 500*time.Millisecond, "poison message should reach the dlq")
}

func dlqHasMessage(t *testing.T, ctx context.Context, brokers []string, key string) bool {
	t.Helper()

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     brokers,
		Topic:       "dlq",
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
			var payload deadLetterPayload
			_ = json.Unmarshal(m.Value, &payload)
			return payload.OriginalTopic == "posts"
		}
	}
}
