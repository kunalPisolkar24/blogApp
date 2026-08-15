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
	source messageSource
	sink   messageSink
}

// drainTimeout is the idle window that ends a run: after a message has
// been replayed, the replayer keeps reading until no message arrives
// for this long. Every message restarts the window, so slow but steady
// dead letter traffic never ends the run prematurely. The first fetch
// also fits inside it, including the consumer group join.
const drainTimeout = 30 * time.Second

// malformedError marks a dead letter that can never be replayed (broken
// envelope, missing original topic). Such messages are skipped instead
// of aborting the rest of the run.
type malformedError struct {
	error
}

func (e malformedError) Unwrap() error {
	return e.error
}

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
	return &Replayer{source: reader, sink: writer}
}

// Run replays messages until the topic is drained, then returns the
// number of messages replayed. Malformed dead letters are skipped and
// logged; only republish failures abort the run.
//
// Replay is at-least-once: a message is committed only after it has
// been republished, so a crash between the write and the commit replays
// it once more. The consumers upsert idempotently, which makes the
// double delivery benign.
func (r *Replayer) Run(ctx context.Context) (int, error) {
	replayed := 0
	skipped := 0
	for {
		msg, err := r.next(ctx, drainTimeout)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				break
			}
			return replayed, err
		}

		if err := r.replay(ctx, msg); err != nil {
			var malformed malformedError
			if !errors.As(err, &malformed) {
				return replayed, err
			}
			skipped++
			slog.Warn("skipping malformed dead letter",
				"error", err,
				"partition", msg.Partition,
				"offset", msg.Offset,
			)
		} else {
			replayed++
			slog.Info("dead letter replayed",
				"topic", msg.Topic,
				"partition", msg.Partition,
				"offset", msg.Offset,
			)
		}

		if err := r.source.CommitMessages(ctx, msg); err != nil {
			return replayed, fmt.Errorf("commit replayed message: %w", err)
		}
	}
	if skipped > 0 {
		slog.Warn("replay complete with skipped messages", "replayed", replayed, "skipped", skipped)
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
		return malformedError{fmt.Errorf("parse dead letter: %w", err)}
	}
	if deadLetter.OriginalTopic == "" {
		return malformedError{errors.New("dead letter is missing originalTopic")}
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
