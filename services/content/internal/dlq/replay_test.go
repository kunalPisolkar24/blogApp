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
	msgs      []kafka.Message
	fetchErr  error
	commitErr error
	commits   []kafka.Message
	closed    bool
}

func (s *fakeSource) FetchMessage(ctx context.Context) (kafka.Message, error) {
	if len(s.msgs) > 0 {
		m := s.msgs[0]
		s.msgs = s.msgs[1:]
		return m, nil
	}
	if s.fetchErr != nil {
		return kafka.Message{}, s.fetchErr
	}
	return kafka.Message{}, context.DeadlineExceeded
}

func (s *fakeSource) CommitMessages(ctx context.Context, msgs ...kafka.Message) error {
	if s.commitErr != nil {
		return s.commitErr
	}
	s.commits = append(s.commits, msgs...)
	return nil
}

func (s *fakeSource) Close() error {
	s.closed = true
	return nil
}

type fakeSink struct {
	writeErr error
	written  []kafka.Message
	closed   bool
}

func (s *fakeSink) WriteMessages(ctx context.Context, msgs ...kafka.Message) error {
	if s.writeErr != nil {
		return s.writeErr
	}
	s.written = append(s.written, msgs...)
	return nil
}

func (s *fakeSink) Close() error {
	s.closed = true
	return nil
}

func deadLetterValue(t *testing.T, topic string, payload []byte) []byte {
	t.Helper()
	value, err := json.Marshal(messaging.DeadLetterMessage{
		OriginalTopic: topic,
		Error:         "boom",
		Payload:       payload,
		Timestamp:     time.Now(),
	})
	require.NoError(t, err)
	return value
}

func newTestReplayer(source messageSource, sink messageSink) *Replayer {
	return &Replayer{source: source, sink: sink}
}

func TestReplayRepublishesToOriginalTopic(t *testing.T) {
	source := &fakeSource{msgs: []kafka.Message{
		{Key: []byte("p_1"), Value: deadLetterValue(t, "posts", []byte("v1")), Partition: 0, Offset: 1},
		{Key: []byte("p_2"), Value: deadLetterValue(t, "posts", []byte("v2")), Partition: 0, Offset: 2},
	}}
	sink := &fakeSink{}
	r := newTestReplayer(source, sink)

	replayed, err := r.Run(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 2, replayed)
	require.Len(t, sink.written, 2)
	assert.Equal(t, "posts", sink.written[0].Topic)
	assert.Equal(t, []byte("p_1"), sink.written[0].Key)
	assert.Equal(t, []byte("v1"), sink.written[0].Value)
	assert.Equal(t, []byte("p_2"), sink.written[1].Key)
	require.Len(t, source.commits, 2, "each replayed message must be committed")
}

func TestReplaySkipsMalformedDeadLetters(t *testing.T) {
	source := &fakeSource{msgs: []kafka.Message{
		{Key: []byte("p_1"), Value: deadLetterValue(t, "posts", []byte("v1")), Partition: 0, Offset: 1},
		{Key: []byte("p_2"), Value: []byte("{not json"), Partition: 0, Offset: 2},
		{Key: []byte("p_3"), Value: deadLetterValue(t, "", []byte("v3")), Partition: 0, Offset: 3},
		{Key: []byte("p_4"), Value: deadLetterValue(t, "posts", []byte("v4")), Partition: 0, Offset: 4},
	}}
	sink := &fakeSink{}
	r := newTestReplayer(source, sink)

	replayed, err := r.Run(context.Background())
	require.NoError(t, err, "one malformed dead letter must not abort the run")
	assert.Equal(t, 2, replayed)
	require.Len(t, sink.written, 2)
	assert.Equal(t, []byte("v1"), sink.written[0].Value)
	assert.Equal(t, []byte("v4"), sink.written[1].Value)
	require.Len(t, source.commits, 4, "skipped messages must be committed too")
}

func TestReplayAbortsOnRepublishFailure(t *testing.T) {
	source := &fakeSource{msgs: []kafka.Message{
		{Key: []byte("p_1"), Value: deadLetterValue(t, "posts", []byte("v1")), Partition: 0, Offset: 1},
	}}
	sink := &fakeSink{writeErr: errors.New("kafka down")}
	r := newTestReplayer(source, sink)

	_, err := r.Run(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "republish posts")
	assert.Empty(t, source.commits, "a failed republish must not be committed")
}

func TestReplayStopsWhenDrained(t *testing.T) {
	source := &fakeSource{}
	r := newTestReplayer(source, &fakeSink{})

	replayed, err := r.Run(context.Background())
	require.NoError(t, err)
	assert.Zero(t, replayed)
}

func TestReplayPropagatesFetchError(t *testing.T) {
	source := &fakeSource{fetchErr: errors.New("consumer lost")}
	r := newTestReplayer(source, &fakeSink{})

	_, err := r.Run(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "consumer lost")
}

func TestReplayPropagatesCommitError(t *testing.T) {
	source := &fakeSource{
		msgs: []kafka.Message{
			{Key: []byte("p_1"), Value: deadLetterValue(t, "posts", []byte("v1")), Partition: 0, Offset: 1},
		},
		commitErr: errors.New("commit failed"),
	}
	r := newTestReplayer(source, &fakeSink{})

	_, err := r.Run(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "commit replayed message")
}

func TestReplayerCloseClosesBothSides(t *testing.T) {
	source := &fakeSource{}
	sink := &fakeSink{}
	r := newTestReplayer(source, sink)

	require.NoError(t, r.Close())
	assert.True(t, source.closed)
	assert.True(t, sink.closed)
}

func TestReplayNextHonoursContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	source := &fakeSource{fetchErr: ctx.Err()}
	r := newTestReplayer(source, &fakeSink{})

	_, err := r.Run(ctx)
	require.Error(t, err, "a cancelled context must not look like a drained topic")
	assert.Contains(t, err.Error(), "context")
}
