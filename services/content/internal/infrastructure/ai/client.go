package ai

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
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
)

// errCircuitOpen is returned by IndexPost/DeletePost while the breaker is
// open so the search worker retries and eventually dead-letters the event
// instead of silently dropping it from the index.
var errCircuitOpen = errors.New("ai circuit breaker open")

// resilientClient talks to the AI service over gRPC and falls back to a
// local noop client when the service is unreachable or failing.
type resilientClient struct {
	primary  domain.AIService
	fallback domain.AIService
	breaker  *circuitBreaker
}

// NewResilientClient returns an AI client that fails over to noop
// generation when the gRPC connection or the service misbehaves.
func NewResilientClient(addr string) domain.AIService {
	return &resilientClient{
		primary:  newGRPCClient(addr),
		fallback: NewNoopAI(),
		breaker:  newCircuitBreaker(),
	}
}

func (c *resilientClient) GenerateSummary(ctx context.Context, text string) (string, error) {
	if c.breaker.canProceed() {
		summary, err := c.primary.GenerateSummary(ctx, text)
		if err == nil {
			c.breaker.recordSuccess()
			return summary, nil
		}
		c.breaker.recordFailure()
		slog.Warn("ai summary generation failed, using fallback", "error", err)
	}
	return c.fallback.GenerateSummary(ctx, text)
}

func (c *resilientClient) GenerateTags(ctx context.Context, title, body string) ([]string, error) {
	if c.breaker.canProceed() {
		tags, err := c.primary.GenerateTags(ctx, title, body)
		if err == nil {
			c.breaker.recordSuccess()
			return tags, nil
		}
		c.breaker.recordFailure()
		slog.Warn("ai tags generation failed, using fallback", "error", err)
	}
	return c.fallback.GenerateTags(ctx, title, body)
}

func (c *resilientClient) GeneratePost(ctx context.Context, prompt string) (*domain.GeneratedPost, error) {
	if c.breaker.canProceed() {
		post, err := c.primary.GeneratePost(ctx, prompt)
		if err == nil {
			c.breaker.recordSuccess()
			return post, nil
		}
		c.breaker.recordFailure()
		slog.Warn("ai post generation failed, using fallback", "error", err)
	}
	return c.fallback.GeneratePost(ctx, prompt)
}

func (c *resilientClient) IndexPost(ctx context.Context, postID, title, body, summary string, tags []string, createdAt time.Time) error {
	if !c.breaker.canProceed() {
		return errCircuitOpen
	}
	if err := c.primary.IndexPost(ctx, postID, title, body, summary, tags, createdAt); err != nil {
		c.breaker.recordFailure()
		return err
	}
	c.breaker.recordSuccess()
	return nil
}

func (c *resilientClient) DeletePost(ctx context.Context, postID string) error {
	if !c.breaker.canProceed() {
		return errCircuitOpen
	}
	if err := c.primary.DeletePost(ctx, postID); err != nil {
		c.breaker.recordFailure()
		return err
	}
	c.breaker.recordSuccess()
	return nil
}

func (c *resilientClient) SearchPosts(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
	if c.breaker.canProceed() {
		result, err := c.primary.SearchPosts(ctx, query, offset, limit)
		if err == nil {
			c.breaker.recordSuccess()
			return result, nil
		}
		c.breaker.recordFailure()
		slog.Warn("ai search failed, using fallback", "error", err)
	}
	return c.fallback.SearchPosts(ctx, query, offset, limit)
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

func (c *grpcClient) Close() error {
	return c.conn.Close()
}

type circuitState int

const (
	stateClosed circuitState = iota
	stateOpen
	stateHalfOpen
)

// circuitBreaker trips after a run of failures and lets a probe through
// after a reset window so the service can recover.
type circuitBreaker struct {
	mu              sync.Mutex
	state           circuitState
	failureCount    int
	successCount    int
	lastFailureTime time.Time
}

func newCircuitBreaker() *circuitBreaker {
	return &circuitBreaker{state: stateClosed}
}

const (
	failureThreshold = 5
	successThreshold = 2
	resetWindow      = 30 * time.Second
)

func (b *circuitBreaker) canProceed() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	switch b.state {
	case stateOpen:
		if time.Since(b.lastFailureTime) > resetWindow {
			b.state = stateHalfOpen
			b.successCount = 0
			return true
		}
		return false
	default:
		return true
	}
}

func (b *circuitBreaker) recordSuccess() {
	b.mu.Lock()
	defer b.mu.Unlock()

	switch b.state {
	case stateHalfOpen:
		b.successCount++
		if b.successCount >= successThreshold {
			b.state = stateClosed
			b.failureCount = 0
		}
	case stateClosed:
		b.failureCount = 0
	}
}

func (b *circuitBreaker) recordFailure() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.failureCount++
	b.lastFailureTime = time.Now()

	switch b.state {
	case stateClosed:
		if b.failureCount >= failureThreshold {
			b.state = stateOpen
		}
	case stateHalfOpen:
		b.state = stateOpen
	}
}
