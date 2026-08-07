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

type stubAI struct {
	summary string
	err     error
	closed  bool
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
	return nil, s.err
}

func (s *stubAI) Close() error {
	s.closed = true
	return nil
}

func TestBreakerStaysClosedOnSuccess(t *testing.T) {
	b := newCircuitBreaker()

	for i := 0; i < failureThreshold+1; i++ {
		b.recordSuccess()
		require.True(t, b.canProceed())
	}
	assert.Equal(t, stateClosed, b.state)
}

func TestBreakerOpensAfterThreshold(t *testing.T) {
	b := newCircuitBreaker()

	for i := 0; i < failureThreshold; i++ {
		b.recordFailure()
	}
	assert.Equal(t, stateOpen, b.state)
	assert.False(t, b.canProceed(), "open breaker must block calls")
}

func TestBreakerHalfOpenSuccessCloses(t *testing.T) {
	b := newCircuitBreaker()
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
	b := newCircuitBreaker()
	for i := 0; i < failureThreshold; i++ {
		b.recordFailure()
	}

	b.lastFailureTime = time.Now().Add(-resetWindow - time.Second)
	require.True(t, b.canProceed())
	b.recordFailure()
	assert.Equal(t, stateOpen, b.state)
}

func TestResilientClientFallsBackOnError(t *testing.T) {
	primary := &stubAI{err: errors.New("unavailable")}
	fallback := &stubAI{summary: "fallback summary"}
	client := &resilientClient{primary: primary, fallback: fallback, breaker: newCircuitBreaker()}

	summary, err := client.GenerateSummary(context.Background(), "text")
	require.NoError(t, err)
	assert.Equal(t, "fallback summary", summary)
}

func TestResilientClientUsesPrimaryOnSuccess(t *testing.T) {
	primary := &stubAI{summary: "primary summary"}
	client := &resilientClient{primary: primary, fallback: &stubAI{summary: "fallback"}, breaker: newCircuitBreaker()}

	summary, err := client.GenerateSummary(context.Background(), "text")
	require.NoError(t, err)
	assert.Equal(t, "primary summary", summary)
}

func TestResilientClientOpenBreakerSkipsPrimary(t *testing.T) {
	primary := &stubAI{summary: "primary"}
	client := &resilientClient{primary: primary, fallback: &stubAI{summary: "fallback summary"}, breaker: newCircuitBreaker()}
	for i := 0; i < failureThreshold; i++ {
		client.breaker.recordFailure()
	}

	summary, err := client.GenerateSummary(context.Background(), "text")
	require.NoError(t, err)
	assert.Equal(t, "fallback summary", summary)
}

func TestResilientClientTagsAndPost(t *testing.T) {
	primary := &stubAI{summary: "x"}
	client := &resilientClient{primary: primary, fallback: &stubAI{}, breaker: newCircuitBreaker()}

	_, err := client.GenerateTags(context.Background(), "t", "b")
	require.NoError(t, err)
	_, err = client.GeneratePost(context.Background(), "p")
	require.NoError(t, err)
}

func TestResilientClientClose(t *testing.T) {
	primary := &stubAI{}
	client := &resilientClient{primary: primary, fallback: &stubAI{}, breaker: newCircuitBreaker()}

	require.NoError(t, client.Close())
	assert.True(t, primary.closed)
}

func TestResilientClientIndexPostPropagatesError(t *testing.T) {
	primary := &stubAI{err: errors.New("unavailable")}
	client := &resilientClient{primary: primary, fallback: &stubAI{}, breaker: newCircuitBreaker()}

	err := client.IndexPost(context.Background(), "p1", "t", "b", "", nil, time.Now())
	require.Error(t, err)
}

func TestResilientClientIndexPostOpenBreaker(t *testing.T) {
	client := &resilientClient{primary: &stubAI{}, fallback: &stubAI{}, breaker: newCircuitBreaker()}
	for i := 0; i < failureThreshold; i++ {
		client.breaker.recordFailure()
	}

	err := client.IndexPost(context.Background(), "p1", "t", "b", "", nil, time.Now())
	require.ErrorIs(t, err, errCircuitOpen)
}

func TestResilientClientDeletePostPropagatesError(t *testing.T) {
	primary := &stubAI{err: errors.New("unavailable")}
	client := &resilientClient{primary: primary, fallback: &stubAI{}, breaker: newCircuitBreaker()}

	err := client.DeletePost(context.Background(), "p1")
	require.Error(t, err)
}

func TestResilientClientDeletePostOpenBreaker(t *testing.T) {
	client := &resilientClient{primary: &stubAI{}, fallback: &stubAI{}, breaker: newCircuitBreaker()}
	for i := 0; i < failureThreshold; i++ {
		client.breaker.recordFailure()
	}

	err := client.DeletePost(context.Background(), "p1")
	require.ErrorIs(t, err, errCircuitOpen)
}
