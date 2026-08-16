//go:build integration

package dlq

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/infrastructure/messaging"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/segmentio/kafka-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReplayRepublishesDeadLetters(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := testutil.StartKafka(t, ctx)
	testutil.EnsureTopic(t, ctx, brokers, "posts")
	testutil.EnsureTopic(t, ctx, brokers, "posts-dlq")

	producer := messaging.NewKafkaProducer(brokers, "posts", "user-interacted")
	t.Cleanup(func() { _ = producer.Close() })
	require.NoError(t, producer.PublishDeadLetter(ctx, "posts", "posts-dlq", []byte("p_r1"), []byte(`{"postId":"p_r1"}`), errors.New("boom")))

	replayer := New(brokers, "posts-dlq", "content-dlq-replay-test")
	t.Cleanup(func() { _ = replayer.Close() })

	replayed, err := replayer.Run(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, replayed, "the dead letter must be replayed onto the posts topic")

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     brokers,
		Topic:       "posts",
		GroupID:     "content-dlq-replay-verify",
		StartOffset: kafka.FirstOffset,
	})
	t.Cleanup(func() { _ = reader.Close() })

	fetchCtx, stop := context.WithTimeout(ctx, 30*time.Second)
	defer stop()
	msg, err := reader.FetchMessage(fetchCtx)
	require.NoError(t, err)
	assert.Equal(t, []byte("p_r1"), msg.Key, "the replayed event must preserve its key")
	assert.Equal(t, `{"postId":"p_r1"}`, string(msg.Value))
}
