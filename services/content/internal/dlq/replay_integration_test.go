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

func TestReplayRoundTripAgainstRealKafka(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	brokers := testutil.StartKafka(t, ctx)
	testutil.EnsureTopic(t, ctx, brokers, "posts")
	testutil.EnsureTopic(t, ctx, brokers, "posts-dlq")

	key := []byte("p_replay")
	original := []byte(`{"postId":"p_replay","title":"Lost in the outage"}`)

	producer := messaging.NewKafkaProducer(brokers, "posts")
	t.Cleanup(func() { _ = producer.Close() })
	require.NoError(t, producer.PublishDeadLetter(ctx, "posts", "posts-dlq", key, original, errors.New("boom")))

	replayer := New(brokers, "posts-dlq", "dlq-replay-test")
	t.Cleanup(func() { _ = replayer.Close() })

	count, err := replayer.Run(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "the single dead letter must be replayed")

	// The event is back on its original topic, unchanged.
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     brokers,
		Topic:       "posts",
		GroupID:     "replay-verify",
		StartOffset: kafka.FirstOffset,
	})
	defer reader.Close()

	msg, err := reader.FetchMessage(ctx)
	require.NoError(t, err)
	assert.Equal(t, key, msg.Key)
	assert.JSONEq(t, string(original), string(msg.Value))
}
