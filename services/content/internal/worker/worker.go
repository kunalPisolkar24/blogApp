package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"regexp"
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

const (
	maxRetries = 3
	retryBase  = 2 * time.Second

	lagReportInterval = 15 * time.Second
)

var (
	htmlTagRegex = regexp.MustCompile(`<[^>]+>`)
	workerTracer = otel.Tracer("content-worker")
)

// Worker consumes post events from Kafka and generates summaries.
// It runs a consumer goroutine per reader; every reader joins the same
// consumer group, so Kafka assigns each one its own partitions and the
// work spreads across readers and replicas while per-partition ordering
// is preserved.
type Worker struct {
	readers   []*kafka.Reader
	processor domain.SummaryProcessor
	aiService domain.AIService
	producer  domain.DLQPublisher
	dlqTopic  string

	running atomic.Bool
	done    chan struct{}
}

// NewWorker validates the consumer configuration and prepares concurrency
// independent readers sharing one consumer group.
func NewWorker(brokers []string, groupID string, topics []string, dlqTopic string, concurrency int, processor domain.SummaryProcessor, aiService domain.AIService, producer domain.DLQPublisher) (*Worker, error) {
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

	w := &Worker{
		processor: processor,
		aiService: aiService,
		producer:  producer,
		dlqTopic:  dlqTopic,
		done:      make(chan struct{}),
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
func (w *Worker) Start(ctx context.Context) {
	defer close(w.done)
	w.running.Store(true)
	defer w.running.Store(false)

	slog.Info("worker starting", "readers", len(w.readers), "dlqTopic", w.dlqTopic)

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

// reportLag refreshes the consumer lag gauges from the kafka-go reader
// stats until the context is cancelled.
func (w *Worker) reportLag(ctx context.Context) {
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

func (w *Worker) consume(ctx context.Context, reader *kafka.Reader) {
	for {
		m, err := reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Error("failed to fetch message", "error", err)
			continue
		}

		processErr := w.processWithRetries(ctx, reader, m)
		if processErr != nil {
			w.sendToDLQ(ctx, reader, m, processErr)
		}

		if err := reader.CommitMessages(ctx, m); err != nil {
			slog.Error("failed to commit message", "error", err, "offset", m.Offset, "partition", m.Partition)
		}
	}
}

func (w *Worker) processWithRetries(ctx context.Context, reader *kafka.Reader, m kafka.Message) error {
	var processErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		processErr = w.processMessage(ctx, m)
		if processErr == nil {
			return nil
		}

		slog.Warn("message processing failed, retrying",
			"error", processErr,
			"attempt", attempt,
			"maxRetries", maxRetries,
			"offset", m.Offset,
			"partition", m.Partition,
		)
		metrics.WorkerRetriesTotal.Inc()

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt) * retryBase):
		}
	}
	return processErr
}

func (w *Worker) sendToDLQ(ctx context.Context, reader *kafka.Reader, m kafka.Message, cause error) {
	slog.Error("message failed after all retries, sending to dlq",
		"error", cause,
		"offset", m.Offset,
		"partition", m.Partition,
		"dlqTopic", w.dlqTopic,
	)
	metrics.WorkerMessagesTotal.WithLabelValues("dlq").Inc()

	if w.producer != nil {
		if err := w.producer.PublishDeadLetter(ctx, m.Topic, w.dlqTopic, m.Key, m.Value, cause); err != nil {
			slog.Error("failed to publish to dlq", "error", err)
		}
	}
}

func (w *Worker) processMessage(ctx context.Context, m kafka.Message) error {
	// Tombstones (nil value) signal deletion and need no work here.
	if len(m.Value) == 0 {
		slog.Debug("skipping tombstone", "partition", m.Partition, "offset", m.Offset)
		metrics.WorkerMessagesTotal.WithLabelValues("skipped").Inc()
		return nil
	}

	var event domain.PostEventPayload
	if err := json.Unmarshal(m.Value, &event); err != nil {
		return fmt.Errorf("unmarshal event: %w", err)
	}
	if strings.TrimSpace(event.PostID) == "" {
		return errors.New("event is missing postId")
	}

	ctx, span := workerTracer.Start(ctx, "process message",
		trace.WithAttributes(
			attribute.String("post.id", event.PostID),
			attribute.Int("kafka.partition", m.Partition),
			attribute.Int64("kafka.offset", m.Offset),
		),
	)
	defer span.End()

	slog.Info("processing message", "postID", event.PostID, "partition", m.Partition, "offset", m.Offset)

	post, err := w.processor.GetPost(ctx, event.PostID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			slog.Info("post no longer exists, skipping", "postID", event.PostID)
			metrics.WorkerMessagesTotal.WithLabelValues("skipped").Inc()
			return nil
		}
		return fmt.Errorf("fetch post: %w", err)
	}

	if strings.TrimSpace(post.Summary) != "" && post.SummaryStatus == domain.PostStatusCompleted {
		slog.Info("summary already completed, skipping", "postID", post.ID)
		metrics.WorkerMessagesTotal.WithLabelValues("skipped").Inc()
		return nil
	}

	body := post.Body
	if strings.TrimSpace(body) == "" && strings.TrimSpace(event.Body) != "" {
		body = event.Body
	}

	cleanBody := stripHTML(body)
	if cleanBody == "" {
		slog.Warn("post has no usable body, marking summary failed", "postID", post.ID)
		err := w.processor.SetPostSummary(ctx, post.ID, "", domain.PostStatusFailed)
		metrics.WorkerMessagesTotal.WithLabelValues("failed").Inc()
		return err
	}

	summary, err := w.aiService.GenerateSummary(ctx, cleanBody)
	if err != nil {
		slog.Warn("ai summary generation failed", "postID", post.ID, "error", err)
		if updateErr := w.processor.SetPostSummary(ctx, post.ID, fallbackSummary(cleanBody), domain.PostStatusFailed); updateErr != nil {
			slog.Error("failed to mark summary failed", "error", updateErr, "postID", post.ID)
		}
		return err
	}

	summary = strings.TrimSpace(summary)
	if summary == "" {
		summary = fallbackSummary(cleanBody)
	}
	if summary == "" {
		return errors.New("ai returned an empty summary")
	}

	if err := w.processor.SetPostSummary(ctx, post.ID, summary, domain.PostStatusCompleted); err != nil {
		return fmt.Errorf("update post summary: %w", err)
	}

	metrics.WorkerMessagesTotal.WithLabelValues("completed").Inc()
	slog.Info("summary generated", "postID", post.ID)
	return nil
}

func (w *Worker) Close() error {
	var errs []error
	for _, reader := range w.readers {
		if err := reader.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Done closes when Start returns.
func (w *Worker) Done() <-chan struct{} {
	return w.done
}

// Running reports whether the consume loops are active.
func (w *Worker) Running() error {
	if w.running.Load() {
		return nil
	}
	return errors.New("worker is not running")
}

func stripHTML(input string) string {
	if strings.TrimSpace(input) == "" {
		return ""
	}
	decoded := html.UnescapeString(input)
	stripped := htmlTagRegex.ReplaceAllString(decoded, " ")
	return normalizeWhitespace(stripped)
}

func fallbackSummary(input string) string {
	normalized := normalizeWhitespace(input)
	if normalized == "" {
		return "Summary is currently unavailable."
	}
	return truncate(normalized, 240)
}

func normalizeWhitespace(input string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(input)), " ")
}

func truncate(input string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(input)
	if len(runes) <= max {
		return input
	}
	cut := string(runes[:max])
	if idx := strings.LastIndex(cut, " "); idx > 0 {
		cut = cut[:idx]
	}
	return strings.TrimSpace(cut) + "..."
}
