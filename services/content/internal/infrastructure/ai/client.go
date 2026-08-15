package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
	pb "github.com/kunalPisolkar24/topos/services/content/proto/ai"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	summaryTimeout = 30 * time.Second
	tagsTimeout    = 15 * time.Second
	postTimeout    = 60 * time.Second
	indexTimeout   = 15 * time.Second
	deleteTimeout  = 10 * time.Second
	searchTimeout  = 10 * time.Second
	relatedTimeout = 5 * time.Second
	chatTimeout    = 120 * time.Second
)

// breakerDomain groups AI RPCs into independent failure domains so a
// problem in one (e.g. chat) cannot degrade unrelated operations.
type breakerDomain string

const (
	domainGeneration breakerDomain = "generation" // GenerateSummary, GenerateTags, GeneratePost
	domainSearch     breakerDomain = "search"     // SearchPosts, RelatedPosts
	domainChat       breakerDomain = "chat"       // ChatAnswer
	domainIndex      breakerDomain = "index"      // IndexPost, DeletePost
)

// resilientClient talks to the AI service over gRPC. Read paths (search,
// related, chat) degrade to a local fallback when the service is
// unreachable; write paths (generation, index, delete) never fabricate
// output and surface errors instead, so workers retry and dead-letter.
type resilientClient struct {
	primary  domain.AIService
	fallback domain.AIService
	breakers map[breakerDomain]*circuitBreaker
}

// NewResilientClient returns an AI client that fails over to noop
// generation when the gRPC connection or the service misbehaves.
func NewResilientClient(addr string) domain.AIService {
	c := &resilientClient{
		primary:  newGRPCClient(addr),
		fallback: NewNoopAI(),
		breakers: map[breakerDomain]*circuitBreaker{
			domainGeneration: newCircuitBreaker(string(domainGeneration)),
			domainSearch:     newCircuitBreaker(string(domainSearch)),
			domainChat:       newCircuitBreaker(string(domainChat)),
			domainIndex:      newCircuitBreaker(string(domainIndex)),
		},
	}
	return c
}

func (c *resilientClient) breaker(d breakerDomain) *circuitBreaker {
	return c.breakers[d]
}

// degraded runs the primary RPC through the domain breaker and returns
// the fallback result when the breaker is open or the primary fails.
// Degradation is counted and logged so operators can see the service
// running in fallback mode.
func degraded[T any](b *circuitBreaker, operation string, primary func() (T, error), fallback func() (T, error)) (T, error) {
	if !b.canProceed() {
		metrics.AIFallbackEngaged.WithLabelValues(operation).Inc()
		return fallback()
	}

	result, err := primary()
	if err != nil {
		b.recordFailure()
		metrics.AIFallbackEngaged.WithLabelValues(operation).Inc()
		slog.Warn("ai "+operation+" failed, using fallback", "error", err)
		return fallback()
	}
	b.recordSuccess()
	return result, nil
}

// noFallback runs the primary RPC through the domain breaker but never
// fabricates content: an open breaker returns ErrAICircuitOpen and a
// primary failure is returned as-is, so the summary worker retries and
// dead-letters instead of persisting degraded output.
func noFallback[T any](b *circuitBreaker, operation string, primary func() (T, error)) (T, error) {
	if !b.canProceed() {
		metrics.AIFallbackEngaged.WithLabelValues(operation).Inc()
		return zero[T](), domain.ErrAICircuitOpen
	}

	result, err := primary()
	if err != nil {
		b.recordFailure()
		metrics.AIFallbackEngaged.WithLabelValues(operation).Inc()
		slog.Warn("ai "+operation+" failed", "error", err)
		return result, err
	}
	b.recordSuccess()
	return result, nil
}

func zero[T any]() (zero T) {
	return
}

func (c *resilientClient) GenerateSummary(ctx context.Context, text string) (string, error) {
	return noFallback(c.breaker(domainGeneration), "summary", func() (string, error) {
		return c.primary.GenerateSummary(ctx, text)
	})
}

func (c *resilientClient) GenerateTags(ctx context.Context, title, body string) ([]string, error) {
	return noFallback(c.breaker(domainGeneration), "tags", func() ([]string, error) {
		return c.primary.GenerateTags(ctx, title, body)
	})
}

func (c *resilientClient) GeneratePost(ctx context.Context, prompt string) (*domain.GeneratedPost, error) {
	return noFallback(c.breaker(domainGeneration), "post", func() (*domain.GeneratedPost, error) {
		return c.primary.GeneratePost(ctx, prompt)
	})
}

func (c *resilientClient) IndexPost(ctx context.Context, postID, title, body, summary string, tags []string, createdAt time.Time) error {
	if !c.breaker(domainIndex).canProceed() {
		metrics.AIFallbackEngaged.WithLabelValues("index").Inc()
		return domain.ErrAICircuitOpen
	}
	if err := c.primary.IndexPost(ctx, postID, title, body, summary, tags, createdAt); err != nil {
		c.breaker(domainIndex).recordFailure()
		return err
	}
	c.breaker(domainIndex).recordSuccess()
	return nil
}

func (c *resilientClient) DeletePost(ctx context.Context, postID string) error {
	if !c.breaker(domainIndex).canProceed() {
		metrics.AIFallbackEngaged.WithLabelValues("delete").Inc()
		return domain.ErrAICircuitOpen
	}
	if err := c.primary.DeletePost(ctx, postID); err != nil {
		c.breaker(domainIndex).recordFailure()
		return err
	}
	c.breaker(domainIndex).recordSuccess()
	return nil
}

func (c *resilientClient) SearchPosts(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
	return degraded(c.breaker(domainSearch), "search",
		func() (*domain.SearchResult, error) { return c.primary.SearchPosts(ctx, query, offset, limit) },
		func() (*domain.SearchResult, error) { return c.fallback.SearchPosts(ctx, query, offset, limit) },
	)
}

func (c *resilientClient) RelatedPosts(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
	return degraded(c.breaker(domainSearch), "related",
		func() (*domain.SearchResult, error) { return c.primary.RelatedPosts(ctx, postID, limit) },
		func() (*domain.SearchResult, error) { return c.fallback.RelatedPosts(ctx, postID, limit) },
	)
}

func (c *resilientClient) ChatAnswer(ctx context.Context, query string, history []domain.ChatTurn, topK int) (*domain.ChatAnswer, error) {
	return degraded(c.breaker(domainChat), "chat",
		func() (*domain.ChatAnswer, error) { return c.primary.ChatAnswer(ctx, query, history, topK) },
		func() (*domain.ChatAnswer, error) { return c.fallback.ChatAnswer(ctx, query, history, topK) },
	)
}

func (c *resilientClient) Close() error {
	return c.primary.Close()
}

type grpcClient struct {
	client pb.AIServiceClient
	conn   *grpc.ClientConn
}

// newGRPCClient dials without blocking; the first call performs the
// actual connection and the circuit breaker absorbs any failures. The
// client handler wires the active tracer into each RPC.
func newGRPCClient(addr string) domain.AIService {
	conn, err := grpc.NewClient(
		addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
	)
	if err != nil {
		panic("grpc.NewClient: " + err.Error())
	}
	return &grpcClient{
		client: pb.NewAIServiceClient(conn),
		conn:   conn,
	}
}

func (c *grpcClient) GenerateSummary(ctx context.Context, text string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, summaryTimeout)
	defer cancel()

	resp, err := c.client.GenerateSummary(ctx, &pb.ContentRequest{Text: text})
	if err != nil {
		return "", err
	}
	return resp.Summary, nil
}

func (c *grpcClient) GenerateTags(ctx context.Context, title, body string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, tagsTimeout)
	defer cancel()

	resp, err := c.client.GenerateTags(ctx, &pb.ContextRequest{Title: title, Body: body})
	if err != nil {
		return nil, err
	}
	return resp.Tags, nil
}

func (c *grpcClient) GeneratePost(ctx context.Context, prompt string) (*domain.GeneratedPost, error) {
	ctx, cancel := context.WithTimeout(ctx, postTimeout)
	defer cancel()

	resp, err := c.client.GeneratePost(ctx, &pb.PostGenerationRequest{Prompt: prompt})
	if err != nil {
		return nil, err
	}
	return &domain.GeneratedPost{
		Title:   resp.Title,
		Body:    resp.Body,
		Summary: resp.Summary,
		Tags:    resp.Tags,
	}, nil
}

func (c *grpcClient) IndexPost(ctx context.Context, postID, title, body, summary string, tags []string, createdAt time.Time) error {
	ctx, cancel := context.WithTimeout(ctx, indexTimeout)
	defer cancel()

	_, err := c.client.IndexPost(ctx, &pb.IndexRequest{
		PostId:    postID,
		Title:     title,
		Body:      body,
		Summary:   summary,
		Tags:      tags,
		CreatedAt: createdAt.UTC().Format(time.RFC3339),
	})
	return err
}

func (c *grpcClient) DeletePost(ctx context.Context, postID string) error {
	ctx, cancel := context.WithTimeout(ctx, deleteTimeout)
	defer cancel()

	_, err := c.client.DeletePost(ctx, &pb.DeleteRequest{PostId: postID})
	return err
}

func (c *grpcClient) SearchPosts(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()

	resp, err := c.client.SearchPosts(ctx, &pb.SearchRequest{
		Query:  query,
		Offset: uint32(offset),
		Limit:  uint32(limit),
	})
	if err != nil {
		return nil, err
	}
	return &domain.SearchResult{
		PostIDs: resp.PostIds,
		Total:   int(resp.Total),
	}, nil
}

func (c *grpcClient) RelatedPosts(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
	ctx, cancel := context.WithTimeout(ctx, relatedTimeout)
	defer cancel()

	resp, err := c.client.RelatedPosts(ctx, &pb.RelatedRequest{
		PostId: postID,
		Limit:  uint32(limit),
	})
	if err != nil {
		return nil, err
	}
	return &domain.SearchResult{
		PostIDs: resp.PostIds,
		Total:   len(resp.PostIds),
	}, nil
}

// ChatAnswer streams the AI response over gRPC and collects the full
// answer plus the cited post ids. A mid-stream error reported by the
// service fails the call so nothing incomplete is persisted.
func (c *grpcClient) ChatAnswer(ctx context.Context, query string, history []domain.ChatTurn, topK int) (*domain.ChatAnswer, error) {
	ctx, cancel := context.WithTimeout(ctx, chatTimeout)
	defer cancel()

	req := &pb.ChatAnswerRequest{
		Query:   query,
		History: mapTurnsToProto(history),
		TopK:    uint32(topK),
	}

	stream, err := c.client.ChatAnswer(ctx, req)
	if err != nil {
		return nil, err
	}

	var sb strings.Builder
	var cited []string
	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if chunk.Error != "" {
			return nil, errors.New(chunk.Error)
		}
		sb.WriteString(chunk.Delta)
		if chunk.Done {
			cited = chunk.CitedPostIds
		}
	}

	return &domain.ChatAnswer{
		Content:      sb.String(),
		CitedPostIDs: cited,
	}, nil
}

func mapTurnsToProto(turns []domain.ChatTurn) []*pb.ChatMessage {
	msgs := make([]*pb.ChatMessage, 0, len(turns))
	for _, turn := range turns {
		msgs = append(msgs, &pb.ChatMessage{
			Role:    string(turn.Role),
			Content: turn.Content,
		})
	}
	return msgs
}

func (c *grpcClient) Close() error {
	return c.conn.Close()
}

type circuitState int

const (
	stateClosed circuitState = iota
	stateOpen
	stateHalfOpen
)

// circuitBreaker trips after a run of failures and lets a single probe
// through after a reset window so the service can recover. The probe is
// exclusive: while one call is in flight in the half-open state, every
// other caller is rejected, so a down service is not hammered with
// concurrent probes.
type circuitBreaker struct {
	mu              sync.Mutex
	domain          string
	state           circuitState
	failureCount    int
	successCount    int
	inFlight        int
	lastFailureTime time.Time
}

func newCircuitBreaker(domain string) *circuitBreaker {
	b := &circuitBreaker{domain: domain, state: stateClosed}
	metrics.AIBreakerState.WithLabelValues(domain).Set(float64(stateClosed))
	return b
}

const (
	failureThreshold = 5
	successThreshold = 2
	resetWindow      = 30 * time.Second
)

func (b *circuitBreaker) setState(s circuitState) {
	b.state = s
	metrics.AIBreakerState.WithLabelValues(b.domain).Set(float64(s))
}

func (b *circuitBreaker) canProceed() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	switch b.state {
	case stateOpen:
		if time.Since(b.lastFailureTime) > resetWindow {
			b.setState(stateHalfOpen)
			b.successCount = 0
			b.inFlight = 1
			return true
		}
		return false
	case stateHalfOpen:
		if b.inFlight > 0 {
			return false
		}
		b.inFlight = 1
		return true
	default:
		return true
	}
}

func (b *circuitBreaker) recordSuccess() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.inFlight = 0

	switch b.state {
	case stateHalfOpen:
		b.successCount++
		if b.successCount >= successThreshold {
			b.setState(stateClosed)
			b.failureCount = 0
		}
	case stateClosed:
		b.failureCount = 0
	}
}

func (b *circuitBreaker) recordFailure() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.inFlight = 0
	b.failureCount++
	b.lastFailureTime = time.Now()

	switch b.state {
	case stateClosed:
		if b.failureCount >= failureThreshold {
			b.setState(stateOpen)
		}
	case stateHalfOpen:
		b.setState(stateOpen)
	}
}
