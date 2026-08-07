package dlq

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/infrastructure/messaging"
	"github.com/segmentio/kafka-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeSource struct {
	messages  []kafka.Message
	fetched   int
	committed int
	fetchErr  error
}

func (f *fakeSource) FetchMessage(context.Context) (kafka.Message, error) {
	if f.fetchErr != nil {
		return kafka.Message{}, f.fetchErr
	}
	if f.fetched >= len(f.messages) {
		return kafka.Message{}, context.DeadlineExceeded
	}
	msg := f.messages[f.fetched]
	f.fetched++
	return msg, nil
}

func (f *fakeSource) CommitMessages(_ context.Context, _ ...kafka.Message) error {
	f.committed++
	return nil
}

func (f *fakeSource) Close() error { return nil }

type fakeSink struct {
	messages []kafka.Message
}

func (f *fakeSink) WriteMessages(_ context.Context, msgs ...kafka.Message) error {
	f.messages = append(f.messages, msgs...)
	return nil
}

func (f *fakeSink) Close() error { return nil }

// deadLetterMessage builds a realistic dead letter message value the
// way the kafka producer would encode it.
func deadLetterMessage(t *testing.T, key string, payload []byte) []byte {
	t.Helper()
	value, err := json.Marshal(messaging.DeadLetterMessage{
		OriginalTopic: "posts",
		Error:         "boom",
		Payload:       payload,
		Timestamp:     time.Now(),
	})
	require.NoError(t, err)
	return value
}

func TestReplayRepublishesDeadLetters(t *testing.T) {
	source := &fakeSource{
		messages: []kafka.Message{
			{Key: []byte("p_1"), Value: deadLetterMessage(t, "p_1", []byte(`{"postId":"p_1","title":"one"}`)), Offset: 1},
			{Key: []byte("p_2"), Value: deadLetterMessage(t, "p_2", []byte(`{"postId":"p_2","title":"two"}`)), Offset: 2},
		},
	}
	sink := &fakeSink{}
	replayer := &Replayer{source: source, sink: sink, timeout: 5 * time.Second}

	count, err := replayer.Run(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	require.Len(t, sink.messages, 2)
	assert.Equal(t, "posts", sink.messages[0].Topic)
	assert.Equal(t, "p_1", string(sink.messages[0].Key))
	assert.JSONEq(t, `{"postId":"p_1","title":"one"}`, string(sink.messages[0].Value))

	assert.Equal(t, "posts", sink.messages[1].Topic)
	assert.Equal(t, "p_2", string(sink.messages[1].Key))
	assert.JSONEq(t, `{"postId":"p_2","title":"two"}`, string(sink.messages[1].Value))
	assert.Equal(t, 2, source.committed, "every replayed message must be committed")
}

func TestReplayKeepsOriginalKeyForTombstones(t *testing.T) {
	source := &fakeSource{
		messages: []kafka.Message{
			{Key: []byte("p_1"), Value: deadLetterMessage(t, "p_1", nil), Offset: 1},
		},
	}
	sink := &fakeSink{}
	replayer := &Replayer{source: source, sink: sink, timeout: 5 * time.Second}

	count, err := replayer.Run(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, count)
	require.Len(t, sink.messages, 1)
	assert.Equal(t, "p_1", string(sink.messages[0].Key))
	assert.Nil(t, sink.messages[0].Value, "a tombstone replay must stay a tombstone")
}

func TestReplayStopsOnMalformedDeadLetter(t *testing.T) {
	source := &fakeSource{
		messages: []kafka.Message{{Value: []byte("not a dead letter")}},
	}
	replayer := &Replayer{source: source, sink: &fakeSink{}, timeout: 5 * time.Second}

	_, err := replayer.Run(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse dead letter")
}

func TestReplayReturnsFetchErrors(t *testing.T) {
	source := &fakeSource{fetchErr: errors.New("broker unavailable")}
	replayer := &Replayer{source: source, sink: &fakeSink{}, timeout: 5 * time.Second}

	_, err := replayer.Run(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "broker unavailable")
}

func TestReplayDrainsEmptyTopic(t *testing.T) {
	replayer := &Replayer{source: &fakeSource{}, sink: &fakeSink{}, timeout: 5 * time.Second}

	count, err := replayer.Run(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

func TestParseDeadLetterRoundtrip(t *testing.T) {
	value := deadLetterMessage(t, "p_1", []byte(`{"postId":"p_1"}`))

	deadLetter, err := messaging.ParseDeadLetter(value)
	require.NoError(t, err)
	assert.Equal(t, "posts", deadLetter.OriginalTopic)
	assert.Equal(t, "boom", deadLetter.Error)
	assert.JSONEq(t, `{"postId":"p_1"}`, string(deadLetter.Payload))
}
