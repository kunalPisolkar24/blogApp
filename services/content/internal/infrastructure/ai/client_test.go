package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var errUnavailable = errors.New("unavailable")

type stubAI struct {
	summary   string
	search    []string
	related   []string
	err       error
	healthErr error
	closed    bool
}

func (s *stubAI) GenerateSummary(ctx context.Context, text string) (string, error) {
	return s.summary, s.err
}

func (s *stubAI) GenerateTags(ctx context.Context, title, body string) ([]string, error) {
	return nil, s.err
}

func (s *stubAI) GeneratePost(ctx context.Context, prompt string) (*domain.GeneratedPost, error) {
	return nil, s.err
}

func (s *stubAI) IndexPost(ctx context.Context, postID, title, body, summary string, tags []string, createdAt time.Time) error {
	return s.err
}

func (s *stubAI) DeletePost(ctx context.Context, postID string) error {
	return s.err
}

func (s *stubAI) SearchPosts(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &domain.SearchResult{PostIDs: s.search, Total: len(s.search)}, nil
}

func (s *stubAI) RelatedPosts(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &domain.SearchResult{PostIDs: s.related, Total: len(s.related)}, nil
}

func (s *stubAI) RelatedPostsBatch(ctx context.Context, postIDs []string, limit int) (map[string]*domain.SearchResult, error) {
	if s.err != nil {
		return nil, s.err
	}
	results := make(map[string]*domain.SearchResult, len(postIDs))
	for _, postID := range postIDs {
		results[postID] = &domain.SearchResult{PostIDs: s.related, Total: len(s.related)}
	}
	return results, nil
}

func (s *stubAI) ChatAnswer(ctx context.Context, query string, history []domain.ChatTurn, topK int) (*domain.ChatAnswer, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &domain.ChatAnswer{Content: "answer"}, nil
}

func (s *stubAI) UpdateUserProfile(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) error {
	return s.err
}

func (s *stubAI) RecommendFeed(ctx context.Context, userID string, offset, limit int, mode domain.RecommendMode, seed uint32) (*domain.SearchResult, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &domain.SearchResult{PostIDs: s.search, Total: len(s.search)}, nil
}

func (s *stubAI) DeleteUserProfile(ctx context.Context, userID string) error {
	return s.err
}

func (s *stubAI) Health(_ context.Context) error {
	return s.healthErr
}

func (s *stubAI) Close() error {
	s.closed = true
	return nil
}

func newTestResilientClient(primary, fallback domain.AIService) *resilientClient {
	return &resilientClient{
		primary:  primary,
		fallback: fallback,
		breakers: map[breakerDomain]*circuitBreaker{
			domainGeneration: newCircuitBreaker("test-gen"),
			domainSearch:     newCircuitBreaker("test-search"),
			domainChat:       newCircuitBreaker("test-chat"),
			domainIndex:      newCircuitBreaker("test-index"),
			domainProfile:    newCircuitBreaker("test-profile"),
			domainRecommend:  newCircuitBreaker("test-recommend"),
		},
	}
}

func TestBreakerStaysClosedOnSuccess(t *testing.T) {
	b := newCircuitBreaker("test")

	for i := 0; i < failureThreshold+1; i++ {
		b.recordSuccess()
		require.True(t, b.canProceed())
	}
	assert.Equal(t, stateClosed, b.state)
}

func TestBreakerOpensAfterThreshold(t *testing.T) {
	b := newCircuitBreaker("test")

	for i := 0; i < failureThreshold; i++ {
		b.recordFailure()
	}
	assert.Equal(t, stateOpen, b.state)
	assert.False(t, b.canProceed(), "open breaker must block calls")
}

func TestBreakerHalfOpenSuccessCloses(t *testing.T) {
	b := newCircuitBreaker("test")
	for i := 0; i < failureThreshold; i++ {
		b.recordFailure()
	}

	b.lastFailureTime = time.Now().Add(-resetWindow - time.Second)
	require.True(t, b.canProceed(), "probe must pass after the reset window")
	assert.Equal(t, stateHalfOpen, b.state)

	b.recordSuccess()
	assert.Equal(t, stateHalfOpen, b.state, "one success is not enough to close")
	b.recordSuccess()
	assert.Equal(t, stateClosed, b.state)
}

func TestBreakerHalfOpenFailureReopens(t *testing.T) {
	b := newCircuitBreaker("test")
	for i := 0; i < failureThreshold; i++ {
		b.recordFailure()
	}

	b.lastFailureTime = time.Now().Add(-resetWindow - time.Second)
	require.True(t, b.canProceed())
	b.recordFailure()
	assert.Equal(t, stateOpen, b.state)
}

func TestBreakerHalfOpenAllowsSingleProbe(t *testing.T) {
	b := newCircuitBreaker("test")
	for i := 0; i < failureThreshold; i++ {
		b.recordFailure()
	}
	b.lastFailureTime = time.Now().Add(-resetWindow - time.Second)

	require.True(t, b.canProceed(), "first probe must pass")
	assert.False(t, b.canProceed(), "only one probe may be in flight at a time")
	assert.Equal(t, 1, b.inFlight)

	b.recordSuccess()
	require.True(t, b.canProceed(), "next probe must pass after the first settles")
}

func TestResilientClientSummaryPropagatesPrimaryError(t *testing.T) {
	primary := &stubAI{err: errUnavailable}
	fallback := &stubAI{summary: "fallback summary"}
	client := newTestResilientClient(primary, fallback)

	_, err := client.GenerateSummary(context.Background(), "text")
	require.ErrorIs(t, err, errUnavailable)
}

func TestResilientClientUsesPrimaryOnSuccess(t *testing.T) {
	primary := &stubAI{summary: "primary summary"}
	client := newTestResilientClient(primary, &stubAI{summary: "fallback"})

	summary, err := client.GenerateSummary(context.Background(), "text")
	require.NoError(t, err)
	assert.Equal(t, "primary summary", summary)
}

func TestResilientClientOpenBreakerNeverFabricates(t *testing.T) {
	primary := &stubAI{summary: "primary"}
	client := newTestResilientClient(primary, &stubAI{summary: "fallback summary"})
	for i := 0; i < failureThreshold; i++ {
		client.breaker(domainGeneration).recordFailure()
	}

	summary, err := client.GenerateSummary(context.Background(), "text")
	require.ErrorIs(t, err, domain.ErrAICircuitOpen)
	assert.Empty(t, summary, "generation must not fall back to fabricated content")
}

func TestResilientClientBreakersArePerDomain(t *testing.T) {
	primary := &stubAI{summary: "s"}
	client := newTestResilientClient(primary, &stubAI{summary: "fallback"})
	for i := 0; i < failureThreshold; i++ {
		client.breaker(domainGeneration).recordFailure()
	}

	_, err := client.ChatAnswer(context.Background(), "q", nil, 5)
	require.NoError(t, err, "an open generation breaker must not block chat")

	_, err = client.GenerateTags(context.Background(), "t", "b")
	require.ErrorIs(t, err, domain.ErrAICircuitOpen)
}

func TestResilientClientTagsAndPostPropagateErrors(t *testing.T) {
	primary := &stubAI{err: errUnavailable}
	client := newTestResilientClient(primary, &stubAI{})

	_, err := client.GenerateTags(context.Background(), "t", "b")
	require.ErrorIs(t, err, errUnavailable)
	_, err = client.GeneratePost(context.Background(), "p")
	require.ErrorIs(t, err, errUnavailable)
}

func TestResilientClientClose(t *testing.T) {
	primary := &stubAI{}
	client := newTestResilientClient(primary, &stubAI{})

	require.NoError(t, client.Close())
	assert.True(t, primary.closed)
}

func TestResilientClientIndexPostPropagatesError(t *testing.T) {
	primary := &stubAI{err: errUnavailable}
	client := newTestResilientClient(primary, &stubAI{})

	err := client.IndexPost(context.Background(), "p1", "t", "b", "", nil, time.Now())
	require.ErrorIs(t, err, errUnavailable)
}

func TestResilientClientIndexPostOpenBreaker(t *testing.T) {
	client := newTestResilientClient(&stubAI{}, &stubAI{})
	for i := 0; i < failureThreshold; i++ {
		client.breaker(domainIndex).recordFailure()
	}

	err := client.IndexPost(context.Background(), "p1", "t", "b", "", nil, time.Now())
	require.ErrorIs(t, err, domain.ErrAICircuitOpen)
}

func TestResilientClientDeletePostPropagatesError(t *testing.T) {
	primary := &stubAI{err: errUnavailable}
	client := newTestResilientClient(primary, &stubAI{})

	err := client.DeletePost(context.Background(), "p1")
	require.ErrorIs(t, err, errUnavailable)
}

func TestResilientClientDeletePostOpenBreaker(t *testing.T) {
	client := newTestResilientClient(&stubAI{}, &stubAI{})
	for i := 0; i < failureThreshold; i++ {
		client.breaker(domainIndex).recordFailure()
	}

	err := client.DeletePost(context.Background(), "p1")
	require.ErrorIs(t, err, domain.ErrAICircuitOpen)
}

func TestResilientClientSearchFallsBackOnError(t *testing.T) {
	primary := &stubAI{err: errUnavailable}
	fallback := &stubAI{search: []string{"p9"}}
	client := newTestResilientClient(primary, fallback)

	result, err := client.SearchPosts(context.Background(), "q", 0, 10)
	require.NoError(t, err, "search must degrade instead of failing the request")
	assert.Equal(t, []string{"p9"}, result.PostIDs)
}

func TestResilientClientSearchFallsBackOnOpenBreaker(t *testing.T) {
	client := newTestResilientClient(&stubAI{search: []string{"p1"}}, &stubAI{search: []string{"p9"}})
	for i := 0; i < failureThreshold; i++ {
		client.breaker(domainSearch).recordFailure()
	}

	result, err := client.SearchPosts(context.Background(), "q", 0, 10)
	require.NoError(t, err)
	assert.Equal(t, []string{"p9"}, result.PostIDs, "fallback result must be used while the breaker is open")
}

func TestResilientClientRelatedPostsUsesPrimaryOnSuccess(t *testing.T) {
	primary := &stubAI{related: []string{"p2", "p3"}}
	client := newTestResilientClient(primary, &stubAI{})

	result, err := client.RelatedPosts(context.Background(), "p1", 5)
	require.NoError(t, err)
	assert.Equal(t, []string{"p2", "p3"}, result.PostIDs)
}

func TestResilientClientRelatedPostsFallsBackOnError(t *testing.T) {
	primary := &stubAI{err: errUnavailable}
	client := newTestResilientClient(primary, &stubAI{})

	result, err := client.RelatedPosts(context.Background(), "p1", 5)
	require.NoError(t, err)
	assert.Empty(t, result.PostIDs)
}

func TestResilientClientChatFallsBackOnOpenBreaker(t *testing.T) {
	client := newTestResilientClient(&stubAI{}, &stubAI{})
	for i := 0; i < failureThreshold; i++ {
		client.breaker(domainChat).recordFailure()
	}

	answer, err := client.ChatAnswer(context.Background(), "q", nil, 5)
	require.NoError(t, err)
	assert.Equal(t, "answer", answer.Content)
}

func TestResilientClientHealthOkWhenBreakersClosed(t *testing.T) {
	primary := &stubAI{}
	client := newTestResilientClient(primary, &stubAI{})

	require.NoError(t, client.Health(context.Background()))
}

func TestResilientClientHealthFailsWhenBreakerOpen(t *testing.T) {
	client := newTestResilientClient(&stubAI{}, &stubAI{})
	for i := 0; i < failureThreshold; i++ {
		client.breaker(domainIndex).recordFailure()
	}

	err := client.Health(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "index")
}

func TestResilientClientHealthSurfacesPrimaryUnavailability(t *testing.T) {
	primary := &stubAI{healthErr: errors.New("ai grpc connection is TransientFailure")}
	client := newTestResilientClient(primary, &stubAI{})

	err := client.Health(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "TransientFailure")
}

func TestGRPCClientHealthFailsWithoutConnection(t *testing.T) {
	client := newGRPCClient("localhost:1")

	err := client.Health(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "connection is")
	require.NoError(t, client.Close())
}
