package service

import (
	"context"
	"fmt"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	draftAuthorID = "author_1"
	draftPeerID   = "peer_1"
)

func newDraftService(
	t *testing.T,
	draftRepo *testutil.MockPostDraftRepository,
	ai *testutil.MockAIService,
	postRepo *testutil.MockPostRepository,
) *PostDraftService {
	t.Helper()

	if draftRepo == nil {
		draftRepo = &testutil.MockPostDraftRepository{}
	}
	if ai == nil {
		ai = &testutil.MockAIService{}
	}
	return NewPostDraftService(draftRepo, ai, newService(t, postRepo, nil, nil))
}

func pendingDraft(id string) *domain.PostDraft {
	return &domain.PostDraft{
		ID:         id,
		ApprovalID: "approval-" + id,
		Title:      "Generated title",
		Body:       "Generated body",
		Summary:    "Generated summary",
		Tags:       []string{"ai"},
		Status:     domain.DraftStatusPending,
		AuthorID:   draftAuthorID,
	}
}

func TestCreateDraftGeneratesAndPersists(t *testing.T) {
	var capturedPrompt string
	ai := &testutil.MockAIService{GenerateDraftFn: func(ctx context.Context, prompt string) (*domain.GeneratedDraft, error) {
		capturedPrompt = prompt
		return &domain.GeneratedDraft{
			GeneratedPost: domain.GeneratedPost{
				Title:   "T",
				Body:    "B",
				Summary: "S",
				Tags:    []string{"tag"},
			},
			ApprovalID: "ap-1",
		}, nil
	}}
	repo := &testutil.MockPostDraftRepository{}
	s := newDraftService(t, repo, ai, nil)

	draft, err := s.CreateDraft(context.Background(), "write about kafka", draftAuthorID)
	require.NoError(t, err)
	assert.Equal(t, "write about kafka", capturedPrompt)
	assert.Equal(t, "ap-1", draft.ApprovalID)
	assert.Equal(t, "T", draft.Title)
	assert.Equal(t, domain.DraftStatusPending, draft.Status)
	assert.Equal(t, draftAuthorID, draft.AuthorID)
}

func TestCreateDraftValidatesInput(t *testing.T) {
	s := newDraftService(t, nil, nil, nil)

	long := make([]byte, maxDraftPromptLen+1)
	_, err := s.CreateDraft(context.Background(), string(long), draftAuthorID)
	require.ErrorIs(t, err, domain.ErrValidation)

	_, err = s.CreateDraft(context.Background(), "prompt", "")
	require.ErrorIs(t, err, domain.ErrUnauthorized)
}

func TestApproveDraftForbiddenForAuthor(t *testing.T) {
	draftRepo := &testutil.MockPostDraftRepository{FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
		return pendingDraft("d1"), nil
	}}
	s := newDraftService(t, draftRepo, nil, nil)

	_, err := s.ApproveDraft(context.Background(), "d1", draftAuthorID, nil)
	require.ErrorIs(t, err, domain.ErrForbidden)
}

func TestApproveDraftPublishesPostThroughCreatePath(t *testing.T) {
	var published *domain.Post
	postRepo := &testutil.MockPostRepository{CreateFn: func(ctx context.Context, post *domain.Post) (*domain.Post, error) {
		published = post
		post.ID = "post-created"
		return post, nil
	}}
	ai := &testutil.MockAIService{ApprovePostFn: func(ctx context.Context, approvalID string, review *domain.DraftReview) (*domain.GeneratedPost, error) {
		require.NotNil(t, review)
		require.NotNil(t, review.Title)
		assert.Equal(t, "Reviewer title", *review.Title)
		return &domain.GeneratedPost{Title: "Reviewer title", Body: "B", Summary: "S", Tags: []string{"t"}}, nil
	}}
	draftRepo := &testutil.MockPostDraftRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
			return pendingDraft("d1"), nil
		},
		TransitionStatusFn: func(ctx context.Context, id string, from []domain.DraftStatus, to domain.DraftStatus) (*domain.PostDraft, error) {
			claimed := pendingDraft(id)
			claimed.Status = to
			return claimed, nil
		},
	}
	s := newDraftService(t, draftRepo, ai, postRepo)

	title := "Reviewer title"
	draft, err := s.ApproveDraft(context.Background(), "d1", draftPeerID, &domain.DraftReview{Title: &title})
	require.NoError(t, err)
	assert.Equal(t, domain.DraftStatusApproved, draft.Status)
	assert.Equal(t, draftAuthorID, draft.AuthorID)
	require.NotNil(t, published, "approval must publish a post through CreatePost")
	assert.Equal(t, draftAuthorID, published.AuthorID, "the post is authored by the draft's author")
	assert.Equal(t, "Reviewer title", published.Title)
	assert.Equal(t, "S", published.Summary, "AI summary ships with the approval")
}

func TestApproveDraftConflictWhenAlreadyClaimed(t *testing.T) {
	draftRepo := &testutil.MockPostDraftRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
			return pendingDraft("d1"), nil
		},
		TransitionStatusFn: func(ctx context.Context, id string, from []domain.DraftStatus, to domain.DraftStatus) (*domain.PostDraft, error) {
			return nil, fmt.Errorf("%w: draft already reviewed", domain.ErrConflict)
		},
	}
	s := newDraftService(t, draftRepo, nil, nil)

	_, err := s.ApproveDraft(context.Background(), "d1", draftPeerID, nil)
	require.ErrorIs(t, err, domain.ErrConflict)
}

func TestRejectDraftRecordsRejectionOnce(t *testing.T) {
	calls := 0
	ai := &testutil.MockAIService{RejectPostFn: func(ctx context.Context, approvalID string, reason string) error {
		calls++
		assert.Equal(t, "needs work", reason)
		return nil
	}}
	draftRepo := &testutil.MockPostDraftRepository{FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
		return pendingDraft("d1"), nil
	}}
	s := newDraftService(t, draftRepo, ai, nil)

	rejected, err := s.RejectDraft(context.Background(), "d1", draftPeerID, "needs work")
	require.NoError(t, err)
	assert.Equal(t, domain.DraftStatusRejected, rejected.Status)

	already := pendingDraft("d1")
	already.Status = domain.DraftStatusRejected
	draftRepo.FindByIDFn = func(ctx context.Context, id string) (*domain.PostDraft, error) {
		return already, nil
	}
	repeat, err := s.RejectDraft(context.Background(), "d1", draftPeerID, "")
	require.NoError(t, err)
	assert.Equal(t, domain.DraftStatusRejected, repeat.Status)
	assert.Equal(t, 1, calls, "repeat rejection short-circuits before the AI call")
}

func TestRejectDraftCannotTouchApprovedDraft(t *testing.T) {
	draftRepo := &testutil.MockPostDraftRepository{FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
		draft := pendingDraft("d1")
		draft.Status = domain.DraftStatusApproved
		return draft, nil
	}}
	s := newDraftService(t, draftRepo, nil, nil)

	_, err := s.RejectDraft(context.Background(), "d1", draftPeerID, "")
	require.ErrorIs(t, err, domain.ErrValidation)
}

func TestWithdrawDraftOwnerOnlyWhilePending(t *testing.T) {
	deleted := ""
	draftRepo := &testutil.MockPostDraftRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
			return pendingDraft("d1"), nil
		},
		DeleteFn: func(ctx context.Context, id string) error {
			deleted = id
			return nil
		},
	}
	s := newDraftService(t, draftRepo, nil, nil)

	require.NoError(t, s.WithdrawDraft(context.Background(), "d1", draftAuthorID))
	assert.Equal(t, "d1", deleted)

	_, err := s.draftRepo.FindByID(context.Background(), "d1")
	_ = err // author may withdraw; a peer may not
	err = s.WithdrawDraft(context.Background(), "d1", draftPeerID)
	require.ErrorIs(t, err, domain.ErrForbidden)
}
