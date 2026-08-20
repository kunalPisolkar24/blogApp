package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/compress"
)

// messageWriter abstracts the kafka writer so tests can exercise the
// publish paths without a broker. *kafka.Writer satisfies it.
type messageWriter interface {
	WriteMessages(ctx context.Context, msgs ...kafka.Message) error
	Close() error
}

type kafkaProducer struct {
	writer          messageWriter
	brokers         []string
	topic           string
	interactedTopic string
}

// NewKafkaProducer returns a producer for the given topics. The hash
// balancer keys messages so every event for the same key lands on the
// same partition, in order. The writer is topic-less; each message
// carries its own topic so the same writer can serve the DLQ.
func NewKafkaProducer(brokers []string, topic string, interactedTopic string) domain.EventProducer {
	writer := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.Hash{},
		MaxAttempts:  10,
		BatchSize:    100,
		BatchTimeout: 10 * time.Millisecond,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		RequiredAcks: kafka.RequireAll,
		Compression:  compress.Gzip,
	}
	return &kafkaProducer{
		writer:          writer,
		brokers:         append([]string(nil), brokers...),
		topic:           topic,
		interactedTopic: interactedTopic,
	}
}

func (k *kafkaProducer) PublishPostCreated(ctx context.Context, post *domain.Post) error {
	return k.publish(ctx, post, domain.EventTypePostCreated)
}

func (k *kafkaProducer) PublishPostUpdated(ctx context.Context, post *domain.Post) error {
	return k.publish(ctx, post, domain.EventTypePostUpdated)
}

// PublishPostDeleted publishes a tombstone: a message with the post id
// as key and a nil value, signalling deletion to consumers.
func (k *kafkaProducer) PublishPostDeleted(ctx context.Context, id string) error {
	return k.writeMessages(ctx, kafka.Message{Topic: k.topic, Key: []byte(id), Time: time.Now()})
}

// PublishUserInteracted publishes an interaction to the dedicated
// user-interacted topic. The message is keyed by user id so all of a
// user's interactions land on the same partition, in order — what the
// personalizer consumer needs to update interest profiles online.
func (k *kafkaProducer) PublishUserInteracted(ctx context.Context, interaction *domain.PostInteraction) error {
	payload := domain.UserInteractedPayload{
		UserID: interaction.UserID,
		PostID: interaction.PostID,
		Kind:   interaction.Kind,
		Weight: interaction.Kind.Weight(),
		Mode:   interaction.Mode,
	}

	value, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal kafka payload: %w", err)
	}

	return k.writeMessages(ctx, kafka.Message{Topic: k.interactedTopic, Key: []byte(interaction.UserID), Value: value, Time: time.Now()})
}

func (k *kafkaProducer) PublishDeadLetter(ctx context.Context, originalTopic, dlqTopic string, key, value []byte, cause error) error {
	payload, err := json.Marshal(DeadLetterMessage{
		OriginalTopic: originalTopic,
		Error:         cause.Error(),
		Payload:       value,
		Timestamp:     time.Now(),
	})
	if err != nil {
		return fmt.Errorf("marshal dlq payload: %w", err)
	}

	return k.writeMessages(ctx, kafka.Message{
		Topic: dlqTopic,
		Key:   key,
		Value: payload,
		Time:  time.Now(),
	})
}

func (k *kafkaProducer) Ping(ctx context.Context) error {
	if len(k.brokers) == 0 {
		return errors.New("kafka brokers not configured")
	}

	dialer := &kafka.Dialer{Timeout: 3 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", k.brokers[0])
	if err != nil {
		return fmt.Errorf("kafka broker %s unreachable: %w", k.brokers[0], err)
	}
	return conn.Close()
}

func (k *kafkaProducer) Close() error {
	return k.writer.Close()
}

func (k *kafkaProducer) publish(ctx context.Context, post *domain.Post, eventType domain.EventType) error {
	payload := domain.PostEventPayload{
		PostID:        post.ID,
		EventType:     eventType,
		Title:         post.Title,
		Body:          post.Body,
		ImageURL:      post.ImageUrl,
		Summary:       post.Summary,
		SummaryStatus: string(post.SummaryStatus),
		Tags:          post.Tags,
		CreatedAt:     post.CreatedAt,
	}

	value, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal kafka payload: %w", err)
	}

	return k.writeMessages(ctx, kafka.Message{Topic: k.topic, Key: []byte(post.ID), Value: value, Time: time.Now()})
}

func (k *kafkaProducer) writeMessages(ctx context.Context, msgs ...kafka.Message) error {
	publishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()

	if err := k.writer.WriteMessages(publishCtx, msgs...); err != nil {
		slog.Error("kafka write failed", "error", err)
		return err
	}
	return nil
}

// DeadLetterMessage is the envelope written to a dead letter topic. It
// preserves the original event so it can be replayed later.
type DeadLetterMessage struct {
	OriginalTopic string `json:"originalTopic"`
	Error         string `json:"error"`
	// Payload holds the original message bytes; json encodes []byte as
	// base64 so even malformed payloads survive the trip to the DLQ.
	Payload   []byte    `json:"payload"`
	Timestamp time.Time `json:"timestamp"`
}

// ParseDeadLetter decodes a message value read from a dead letter topic.
func ParseDeadLetter(value []byte) (*DeadLetterMessage, error) {
	var msg DeadLetterMessage
	if err := json.Unmarshal(value, &msg); err != nil {
		return nil, fmt.Errorf("unmarshal dead letter message: %w", err)
	}
	return &msg, nil
}
