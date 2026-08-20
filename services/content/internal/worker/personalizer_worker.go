package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
	"github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// PersonalizerWorker turns user.interacted events into online profile
// updates: every view, like or save is folded into the user's interest
// profile by the AI service. It runs in its own consumer group so it
// never competes with the summary or search workers.
var personalizerWorkerTracer = otel.Tracer("content-personalizer")

type PersonalizerWorker struct {
	readers   []*kafka.Reader
	aiService domain.AIService
	producer  domain.DLQPublisher
	dlqTopic  string

	// retry config; overridable by tests to keep them fast
	maxRetries int
	retryBase  time.Duration

	running atomic.Bool
	done    chan struct{}
}

// NewPersonalizerWorker validates the consumer configuration and
// prepares concurrency independent readers sharing one consumer group.
func NewPersonalizerWorker(brokers []string, groupID string, topics []string, dlqTopic string, concurrency int, aiService domain.AIService, producer domain.DLQPublisher) (*PersonalizerWorker, error) {
	if len(brokers) == 0 {
		return nil, errors.New("kafka brokers are required")
	}
	if strings.TrimSpace(groupID) == "" {
		return nil, errors.New("kafka consumer group id is required")
	}
	if len(topics) == 0 {
		return nil, errors.New("kafka consumer topics are required")
	}
	if concurrency < 1 {
		concurrency = 1
	}

	w := &PersonalizerWorker{
		aiService:  aiService,
		producer:   producer,
		dlqTopic:   dlqTopic,
		maxRetries: maxRetries,
		retryBase:  retryBase,
		done:       make(chan struct{}),
	}

	for range concurrency {
		w.readers = append(w.readers, kafka.NewReader(kafka.ReaderConfig{
			Brokers:     brokers,
			GroupID:     groupID,
			GroupTopics: topics,
			MinBytes:    1,
			MaxBytes:    10e6,
			MaxWait:     2 * time.Second,
		}))
	}

	return w, nil
}

// Start runs one consume loop per reader until the context is cancelled.
func (w *PersonalizerWorker) Start(ctx context.Context) {
	defer close(w.done)
	w.running.Store(true)
	defer w.running.Store(false)

	slog.Info("personalizer worker starting", "readers", len(w.readers), "dlqTopic", w.dlqTopic)

	go w.reportLag(ctx)

	var wg sync.WaitGroup
	for _, reader := range w.readers {
		wg.Add(1)
		go func(reader *kafka.Reader) {
			defer wg.Done()
			w.consume(ctx, reader)
		}(reader)
	}
	wg.Wait()
}

func (w *PersonalizerWorker) reportLag(ctx context.Context) {
	ticker := time.NewTicker(lagReportInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for i, reader := range w.readers {
				metrics.WorkerLag.WithLabelValues(strconv.Itoa(i)).Set(float64(reader.Stats().Lag))
			}
		}
	}
}

func (w *PersonalizerWorker) consume(ctx context.Context, reader *kafka.Reader) {
	for {
		m, err := reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Error("failed to fetch message", "error", err)
			continue
		}

		processErr := w.processWithRetries(ctx, m)
		if processErr != nil && ctx.Err() == nil {
			if err := w.sendToDLQ(ctx, m, processErr); err != nil {
				// The offset stays uncommitted so the message is
				// redelivered on the next fetch; back off so a Kafka
				// outage does not spin in a hot loop.
				slog.Error("dlq publish failed, leaving offset uncommitted",
					"error", err,
					"offset", m.Offset,
					"partition", m.Partition,
				)
				metrics.WorkerMessagesTotal.WithLabelValues("dlq_failed").Inc()
				if !sleep(ctx, dlqRetryDelay) {
					return
				}
				continue
			}
		}

		if err := reader.CommitMessages(ctx, m); err != nil {
			slog.Error("failed to commit message", "error", err, "offset", m.Offset, "partition", m.Partition)
		}
	}
}

func (w *PersonalizerWorker) processWithRetries(ctx context.Context, m kafka.Message) error {
	var processErr error
	for attempt := 1; attempt <= w.maxRetries; attempt++ {
		processErr = w.processMessage(ctx, m)
		if processErr == nil {
			return nil
		}
		if isPermanent(processErr) || errors.Is(processErr, domain.ErrAICircuitOpen) {
			return processErr
		}

		slog.Warn("message processing failed, retrying",
			"error", processErr,
			"attempt", attempt,
			"maxRetries", w.maxRetries,
			"offset", m.Offset,
			"partition", m.Partition,
		)
		metrics.WorkerRetriesTotal.Inc()

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt) * w.retryBase):
		}
	}
	return processErr
}

func (w *PersonalizerWorker) sendToDLQ(ctx context.Context, m kafka.Message, cause error) error {
	slog.Error("message failed after all retries, sending to dlq",
		"error", cause,
		"offset", m.Offset,
		"partition", m.Partition,
		"dlqTopic", w.dlqTopic,
	)
	metrics.WorkerMessagesTotal.WithLabelValues("dlq").Inc()

	if w.producer == nil {
		return nil
	}
	if err := w.producer.PublishDeadLetter(ctx, m.Topic, w.dlqTopic, m.Key, m.Value, cause); err != nil {
		slog.Error("failed to publish to dlq", "error", err)
		return err
	}
	return nil
}

func (w *PersonalizerWorker) processMessage(ctx context.Context, m kafka.Message) error {
	// Tombstones (nil value) carry no interaction data; nothing to fold.
	if len(m.Value) == 0 {
		slog.Debug("skipping tombstone", "partition", m.Partition, "offset", m.Offset)
		metrics.WorkerMessagesTotal.WithLabelValues("skipped").Inc()
		return nil
	}

	var payload domain.UserInteractedPayload
	if err := json.Unmarshal(m.Value, &payload); err != nil {
		return permanentf("unmarshal interaction: %w", err)
	}
	if strings.TrimSpace(payload.UserID) == "" || strings.TrimSpace(payload.PostID) == "" {
		return permanentf("interaction is missing userId or postId")
	}

	ctx, span := personalizerWorkerTracer.Start(ctx, "update user profile",
		trace.WithAttributes(
			attribute.String("user.id", payload.UserID),
			attribute.String("post.id", payload.PostID),
			attribute.Int("kafka.partition", m.Partition),
			attribute.Int64("kafka.offset", m.Offset),
		),
	)
	defer span.End()

	if err := w.aiService.UpdateUserProfile(ctx, payload.UserID, payload.PostID, payload.Kind); err != nil {
		return fmt.Errorf("update user profile: %w", err)
	}

	slog.Info("user profile updated", "userID", payload.UserID, "postID", payload.PostID, "kind", payload.Kind)
	metrics.WorkerMessagesTotal.WithLabelValues("completed").Inc()
	return nil
}

func (w *PersonalizerWorker) Close() error {
	var errs []error
	for _, reader := range w.readers {
		if err := reader.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Done closes when Start returns.
func (w *PersonalizerWorker) Done() <-chan struct{} {
	return w.done
}

// Running reports whether the consume loops are active.
func (w *PersonalizerWorker) Running() error {
	if w.running.Load() {
		return nil
	}
	return errors.New("personalizer worker is not running")
}

// Healthy reports whether the worker can do real work: the consume
// loops are running and the AI service is available (no open breaker,
// ready connection). A worker whose messages are being dead-lettered
// because the AI service is down must not report ready.
func (w *PersonalizerWorker) Healthy(ctx context.Context) error {
	if err := w.Running(); err != nil {
		return err
	}
	return w.aiService.Health(ctx)
}
