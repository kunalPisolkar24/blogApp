// Package dlq replays dead letter messages back onto their original
// topic so the workers can process them again.
package dlq

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/infrastructure/messaging"
	"github.com/segmentio/kafka-go"
)

// messageSource is the read side of the replay: a kafka.Reader.
type messageSource interface {
	FetchMessage(ctx context.Context) (kafka.Message, error)
	CommitMessages(ctx context.Context, msgs ...kafka.Message) error
	Close() error
}

// messageSink is the write side of the replay: a kafka.Writer.
type messageSink interface {
	WriteMessages(ctx context.Context, msgs ...kafka.Message) error
	Close() error
}

// Replayer reads dead letter messages and republishes them to their
// original topic. It uses a consumer group so a second run resumes where
// the previous one stopped instead of replaying everything again.
type Replayer struct {
	source  messageSource
	sink    messageSink
	timeout time.Duration
}

// warmupTimeout covers the consumer group join on the first fetch;
// after that a replayer is reading live and only needs a short idle
// window to decide the topic is drained.
const warmupTimeout = 30 * time.Second

// New creates a Replayer that reads from the given dlq topic and
// republishes events to the topic recorded in each message. The hash
// balancer keeps per-post ordering, matching the regular producer.
func New(brokers []string, dlqTopic string, groupID string) *Replayer {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     brokers,
		GroupID:     groupID,
		GroupTopics: []string{dlqTopic},
		MinBytes:    1,
		MaxBytes:    10e6,
		MaxWait:     2 * time.Second,
		// First run starts at the oldest message; later runs resume from
		// the group's last committed offset.
		StartOffset: kafka.FirstOffset,
	})
	writer := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.Hash{},
		MaxAttempts:  10,
		BatchSize:    100,
		BatchTimeout: 10 * time.Millisecond,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		RequiredAcks: kafka.RequireAll,
	}
	return &Replayer{source: reader, sink: writer, timeout: 5 * time.Second}
}

// Run replays messages until the topic is drained, then returns the
// number of messages replayed. A message is committed only after it has
// been republished successfully.
func (r *Replayer) Run(ctx context.Context) (int, error) {
	replayed := 0
	for {
		// The first fetch must fit the consumer group join in its
		// budget; only later fetches get the short drain timeout.
		budget := warmupTimeout
		if replayed > 0 {
			budget = r.timeout
		}

		msg, err := r.next(ctx, budget)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				break
			}
			return replayed, err
		}

		if err := r.replay(ctx, msg); err != nil {
			return replayed, err
		}
		if err := r.source.CommitMessages(ctx, msg); err != nil {
			return replayed, fmt.Errorf("commit replayed message: %w", err)
		}
		replayed++
		slog.Info("dead letter replayed",
			"topic", msg.Topic,
			"partition", msg.Partition,
			"offset", msg.Offset,
		)
	}
	return replayed, nil
}

// next waits for the next dead letter message. The per-fetch timeout
// signals that the topic has been drained.
func (r *Replayer) next(ctx context.Context, timeout time.Duration) (kafka.Message, error) {
	fetchCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return r.source.FetchMessage(fetchCtx)
}

// replay republishes the original event onto its original topic,
// preserving the key so it lands on the same partition as before.
func (r *Replayer) replay(ctx context.Context, msg kafka.Message) error {
	deadLetter, err := messaging.ParseDeadLetter(msg.Value)
	if err != nil {
		return fmt.Errorf("parse dead letter: %w", err)
	}
	if deadLetter.OriginalTopic == "" {
		return errors.New("dead letter is missing originalTopic")
	}

	republished := kafka.Message{
		Topic: deadLetter.OriginalTopic,
		Key:   msg.Key,
		Value: deadLetter.Payload,
	}
	if err := r.sink.WriteMessages(ctx, republished); err != nil {
		return fmt.Errorf("republish %s: %w", deadLetter.OriginalTopic, err)
	}
	return nil
}

// Close releases the reader and writer.
func (r *Replayer) Close() error {
	return errors.Join(r.source.Close(), r.sink.Close())
}
