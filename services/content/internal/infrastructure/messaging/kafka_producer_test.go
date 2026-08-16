package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/segmentio/kafka-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeWriter struct {
	messages []kafka.Message
	err      error
	closed   bool
}

func (w *fakeWriter) WriteMessages(ctx context.Context, msgs ...kafka.Message) error {
	if w.err != nil {
		return w.err
	}
	w.messages = append(w.messages, msgs...)
	return nil
}

func (w *fakeWriter) Close() error {
	w.closed = true
	return nil
}

func newTestProducer(t *testing.T, w messageWriter) *kafkaProducer {
	t.Helper()
	return &kafkaProducer{
		writer:          w,
		topic:           "posts",
		interactedTopic: "user-interacted",
		brokers:         []string{"localhost:9092"},
	}
}

func ptr(s string) *string { return &s }

func TestPublishPostEvent(t *testing.T) {
	w := &fakeWriter{}
	producer := newTestProducer(t, w)

	post := &domain.Post{ID: "p_1", Title: "Hello", Body: "World", ImageUrl: ptr("http://img"), Summary: "S", SummaryStatus: domain.PostStatusPending, CreatedAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)}

	require.NoError(t, producer.PublishPostCreated(context.Background(), post))
	require.Len(t, w.messages, 1)
	assert.Equal(t, "posts", w.messages[0].Topic)
	assert.Equal(t, []byte("p_1"), w.messages[0].Key)

	var payload domain.PostEventPayload
	require.NoError(t, json.Unmarshal(w.messages[0].Value, &payload))
	assert.Equal(t, "p_1", payload.PostID)
	assert.Equal(t, domain.EventTypePostCreated, payload.EventType)
	assert.Equal(t, "Hello", payload.Title)
	assert.Equal(t, string(domain.PostStatusPending), payload.SummaryStatus)

	require.NoError(t, producer.PublishPostUpdated(context.Background(), post))
	require.Len(t, w.messages, 2)

	var updated domain.PostEventPayload
	require.NoError(t, json.Unmarshal(w.messages[1].Value, &updated))
	assert.Equal(t, domain.EventTypePostUpdated, updated.EventType, "created and updated events must be distinguishable")
}

func TestPublishPostTombstone(t *testing.T) {
	w := &fakeWriter{}
	producer := newTestProducer(t, w)

	require.NoError(t, producer.PublishPostDeleted(context.Background(), "p_42"))
	require.Len(t, w.messages, 1)
	assert.Equal(t, []byte("p_42"), w.messages[0].Key)
	assert.Nil(t, w.messages[0].Value, "tombstones carry no value")
}

func TestPublishUserInteracted(t *testing.T) {
	tests := []struct {
		name   string
		kind   domain.PostInteractionKind
		weight int
	}{
		{name: "view", kind: domain.PostInteractionView, weight: 1},
		{name: "like", kind: domain.PostInteractionLike, weight: 3},
		{name: "save", kind: domain.PostInteractionSave, weight: 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := &fakeWriter{}
			producer := newTestProducer(t, w)

			interaction := &domain.PostInteraction{
				UserID: "u_1",
				PostID: "p_1",
				Kind:   tt.kind,
			}
			require.NoError(t, producer.PublishUserInteracted(context.Background(), interaction))
			require.Len(t, w.messages, 1)

			msg := w.messages[0]
			assert.Equal(t, "user-interacted", msg.Topic)
			assert.Equal(t, []byte("u_1"), msg.Key, "interactions are keyed by user id")

			var payload domain.UserInteractedPayload
			require.NoError(t, json.Unmarshal(msg.Value, &payload))
			assert.Equal(t, "u_1", payload.UserID)
			assert.Equal(t, "p_1", payload.PostID)
			assert.Equal(t, tt.kind, payload.Kind)
			assert.Equal(t, tt.weight, payload.Weight)
		})
	}
}

func TestPublishDeadLetter(t *testing.T) {
	w := &fakeWriter{}
	producer := newTestProducer(t, w)

	require.NoError(t, producer.PublishDeadLetter(context.Background(), "posts", "dlq", []byte("key"), []byte(`{"x":1}`), errors.New("boom")))
	require.Len(t, w.messages, 1)
	assert.Equal(t, "dlq", w.messages[0].Topic)
	assert.Equal(t, []byte("key"), w.messages[0].Key)

	var payload DeadLetterMessage
	require.NoError(t, json.Unmarshal(w.messages[0].Value, &payload))
	assert.Equal(t, "posts", payload.OriginalTopic)
	assert.Equal(t, "boom", payload.Error)
	assert.Equal(t, `{"x":1}`, string(payload.Payload))
	assert.False(t, payload.Timestamp.IsZero())
}

func TestPublishDeadLetterPreservesMalformedPayload(t *testing.T) {
	w := &fakeWriter{}
	producer := newTestProducer(t, w)

	require.NoError(t, producer.PublishDeadLetter(context.Background(), "posts", "dlq", []byte("k"), []byte("not json"), errors.New("parse")))
	var payload DeadLetterMessage
	require.NoError(t, json.Unmarshal(w.messages[0].Value, &payload))
	assert.Equal(t, "not json", string(payload.Payload))
}

func TestPublishForwardsWriterError(t *testing.T) {
	w := &fakeWriter{err: errors.New("kafka down")}
	producer := newTestProducer(t, w)

	err := producer.PublishPostCreated(context.Background(), &domain.Post{ID: "p_1"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "kafka down")
}

func TestClose(t *testing.T) {
	w := &fakeWriter{}
	producer := newTestProducer(t, w)

	require.NoError(t, producer.Close())
	assert.True(t, w.closed)
}

func TestPingNoBrokers(t *testing.T) {
	producer := &kafkaProducer{writer: &fakeWriter{}, brokers: nil}
	require.Error(t, producer.Ping(context.Background()))
}

func TestPingUnreachableBroker(t *testing.T) {
	producer := &kafkaProducer{writer: &fakeWriter{}, brokers: []string{"127.0.0.1:1"}}
	err := producer.Ping(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unreachable")
}
