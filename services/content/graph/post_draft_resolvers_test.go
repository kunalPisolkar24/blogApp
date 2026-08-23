package graph

// Draft workflow resolver tests: the peer-review rules surface here as
// forbidden errors for self-actions, and approvals publish through the
// regular CreatePost path.

import (
	"context"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/graph/model"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

func newTestDraftResolver(
	t *testing.T,
	draftRepo *testutil.MockPostDraftRepository,
	ai *testutil.MockAIService,
) *Resolver {
	t.Helper()

	if draftRepo == nil {
		draftRepo = &testutil.MockPostDraftRepository{}
	}
	if ai == nil {
		ai = &testutil.MockAIService{}
	}
	postSvc := service.NewPostService(&testutil.MockPostRepository{}, &testutil.MockTagRepository{}, nil, nil, nil)
	return NewResolver(
		postSvc,
		service.NewTagService(&testutil.MockTagRepository{}, nil),
		service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{}),
		service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil),
		service.NewPostDraftService(draftRepo, ai, postSvc),
	)
}

func TestMutationResolverCreatePostDraft(t *testing.T) {
	resolver := newTestDraftResolver(t, nil, nil)

	draft, err := resolver.Mutation().CreatePostDraft(authenticatedContext("u_1"), "write about go")
	require.NoError(t, err)
	assert.Equal(t, "approval-1", draft.ApprovalID)
	assert.Equal(t, "PENDING", string(draft.Status))
}

func TestMutationResolverCreatePostDraftUnauthorized(t *testing.T) {
	resolver := newTestDraftResolver(t, nil, nil)

	_, err := resolver.Mutation().CreatePostDraft(context.Background(), "prompt")
	require.Error(t, err)
	assert.Equal(t, "unauthorized", err.(*gqlerror.Error).Message)
}

func TestMutationResolverApprovePostDraftForbiddenForAuthor(t *testing.T) {
	draftRepo := &testutil.MockPostDraftRepository{FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
		return &domain.PostDraft{ID: id, ApprovalID: "ap-1", AuthorID: "u_1", Status: domain.DraftStatusPending}, nil
	}}
	resolver := newTestDraftResolver(t, draftRepo, nil)

	_, err := resolver.Mutation().ApprovePostDraft(authenticatedContext("u_1"), "d1", nil)
	require.Error(t, err)
	assert.Equal(t, "forbidden", err.(*gqlerror.Error).Message)
}

func TestMutationResolverApprovePostDraftPublishesForPeer(t *testing.T) {
	draftRepo := &testutil.MockPostDraftRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
			return &domain.PostDraft{ID: id, ApprovalID: "ap-1", AuthorID: "author-9", Status: domain.DraftStatusPending}, nil
		},
		TransitionStatusFn: func(ctx context.Context, id string, from []domain.DraftStatus, to domain.DraftStatus) (*domain.PostDraft, error) {
			return &domain.PostDraft{ID: id, ApprovalID: "ap-1", AuthorID: "author-9", Status: to}, nil
		},
	}
	ai := &testutil.MockAIService{ApprovePostFn: func(ctx context.Context, approvalID string, review *domain.DraftReview) (*domain.GeneratedPost, error) {
		return &domain.GeneratedPost{Title: "Peer approved title", Body: "B", Summary: "S", Tags: []string{"t"}}, nil
	}}
	resolver := newTestDraftResolver(t, draftRepo, ai)

	title := "Peer approved title"
	draft, err := resolver.Mutation().ApprovePostDraft(authenticatedContext("peer-1"), "d1", &model.DraftEditsInput{Title: &title})
	require.NoError(t, err)
	assert.Equal(t, "APPROVED", string(draft.Status))
	assert.NotNil(t, draft.PostID)
	if draft.PostID != nil {
		assert.Equal(t, "id-created", *draft.PostID)
	}
	assert.Equal(t, "Peer approved title", draft.Title)
}

func TestMutationResolverRejectPostDraftPassesReason(t *testing.T) {
	var capturedReason string
	ai := &testutil.MockAIService{RejectPostFn: func(ctx context.Context, approvalID string, reason string) error {
		capturedReason = reason
		return nil
	}}
	draftRepo := &testutil.MockPostDraftRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.PostDraft, error) {
			return &domain.PostDraft{ID: id, ApprovalID: "ap-1", AuthorID: "author-9", Status: domain.DraftStatusPending}, nil
		},
		TransitionStatusFn: func(ctx context.Context, id string, from []domain.DraftStatus, to domain.DraftStatus) (*domain.PostDraft, error) {
			return &domain.PostDraft{ID: id, Status: to}, nil
		},
	}
	resolver := newTestDraftResolver(t, draftRepo, ai)

	reason := "needs a better intro"
	draft, err := resolver.Mutation().RejectPostDraft(authenticatedContext("peer-1"), "d1", &reason)
	require.NoError(t, err)
	assert.Equal(t, "REJECTED", string(draft.Status))
	assert.Equal(t, "needs a better intro", capturedReason)
}

func TestMutationResolverDeletePostDraftUnauthorized(t *testing.T) {
	resolver := newTestDraftResolver(t, nil, nil)

	_, err := resolver.Mutation().DeletePostDraft(context.Background(), "d1")
	require.Error(t, err)
	assert.Equal(t, "unauthorized", err.(*gqlerror.Error).Message)
}

func TestQueryResolverPostDraftsUnauthorized(t *testing.T) {
	resolver := newTestDraftResolver(t, nil, nil)

	_, err := resolver.Query().PostDrafts(context.Background(), nil, nil)
	require.Error(t, err)
	assert.Equal(t, "unauthorized", err.(*gqlerror.Error).Message)
}
