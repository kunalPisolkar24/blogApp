package service

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestConcurrentApproveDraftsPublishExactlyOnePost drives the review
// flow with five reviewers racing on the same pending draft. The mock
// repository enforces the same atomic transition Mongo's
// FindOneAndUpdate gives us, so the test proves the service composes
// claim-then-publish into exactly one post no matter who wins.
func TestConcurrentApproveDraftsPublishExactlyOnePost(t *testing.T) {
	var (
		mu           sync.Mutex
		status       = domain.DraftStatusPending
		publishCalls atomic.Int32
	)
	reviewerCount := 5

	draftRepo := &testutil.MockPostDraftRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
			mu.Lock()
			defer mu.Unlock()
			draft := pendingDraft(id)
			draft.Status = status
			return draft, nil
		},
		TransitionStatusFn: func(
			ctx context.Context, id string, from []domain.DraftStatus, to domain.DraftStatus,
		) (*domain.PostDraft, error) {
			mu.Lock()
			defer mu.Unlock()
			for _, allowed := range from {
				if status == allowed {
					status = to
					claimed := pendingDraft(id)
					claimed.Status = to
					return claimed, nil
				}
			}
			return nil, fmt.Errorf("%w: draft already reviewed", domain.ErrConflict)
		},
	}
	ai := &testutil.MockAIService{ApprovePostFn: func(ctx context.Context, approvalID string, review *domain.DraftReview) (*domain.GeneratedPost, error) {
		return &domain.GeneratedPost{Title: "Generated title", Body: "Body", Summary: "Summary", Tags: []string{"t"}}, nil
	}}
	postRepo := &testutil.MockPostRepository{CreateFn: func(
		ctx context.Context, post *domain.Post,
	) (*domain.Post, error) {
		publishCalls.Add(1)
		post.ID = fmt.Sprintf("post-%d", publishCalls.Load())
		return post, nil
	}}
	s := newDraftService(t, draftRepo, ai, postRepo)

	var successes atomic.Int32
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < reviewerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := s.ApproveDraft(context.Background(), "d1", draftPeerID, nil)
			if err == nil {
				successes.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()

	require.EqualValues(t, 1, successes.Load(), "only one reviewer wins")
	assert.EqualValues(t, 1, publishCalls.Load(), "exactly one post is published")

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, domain.DraftStatusApproved, status)
}

// TestApproveAfterRejectStillPublishes pins the soft-terminal rule: a
// rejected draft is resumable, and approval from that state publishes.
func TestApproveAfterRejectStillPublishes(t *testing.T) {
	var (
		mu     sync.Mutex
		status = domain.DraftStatusRejected
	)
	ai := &testutil.MockAIService{ApprovePostFn: func(ctx context.Context, approvalID string, review *domain.DraftReview) (*domain.GeneratedPost, error) {
		return &domain.GeneratedPost{Title: "Generated title", Body: "Body", Summary: "Summary", Tags: []string{"t"}}, nil
	}}
	draftRepo := &testutil.MockPostDraftRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
			mu.Lock()
			defer mu.Unlock()
			draft := pendingDraft(id)
			draft.Status = status
			return draft, nil
		},
		TransitionStatusFn: func(
			ctx context.Context, id string, from []domain.DraftStatus, to domain.DraftStatus,
		) (*domain.PostDraft, error) {
			mu.Lock()
			defer mu.Unlock()
			for _, allowed := range from {
				if status == allowed {
					status = to
					claimed := pendingDraft(id)
					claimed.Status = to
					return claimed, nil
				}
			}
			return nil, fmt.Errorf("%w: draft already reviewed", domain.ErrConflict)
		},
	}
	s := newDraftService(t, draftRepo, ai, &testutil.MockPostRepository{})

	draft, err := s.ApproveDraft(context.Background(), "d1", draftPeerID, nil)
	require.NoError(t, err)
	assert.Equal(t, domain.DraftStatusApproved, draft.Status)
}
