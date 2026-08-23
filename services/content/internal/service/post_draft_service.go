package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

// maxDraftPromptLen mirrors the AI service's MAX_POST_CHARS so oversized
// prompts fail fast at the content boundary.
const maxDraftPromptLen = 5000

// PostDraftService drives the peer-review flow: an author creates a
// paused AI draft, a *different* user approves or rejects it, and only
// approval publishes the post through the regular CreatePost path.
type PostDraftService struct {
	draftRepo   domain.PostDraftRepository
	aiService   domain.AIService
	postService *PostService
	clock       func() time.Time
}

func NewPostDraftService(
	draftRepo domain.PostDraftRepository,
	aiService domain.AIService,
	postService *PostService,
) *PostDraftService {
	return &PostDraftService{
		draftRepo:   draftRepo,
		aiService:   aiService,
		postService: postService,
		clock:       time.Now,
	}
}

func (s *PostDraftService) CreateDraft(ctx context.Context, prompt, authorID string) (*domain.PostDraft, error) {
	if authorID == "" {
		return nil, domain.ErrUnauthorized
	}
	if len(prompt) > maxDraftPromptLen {
		return nil, fmt.Errorf("%w: prompt exceeds %d characters", domain.ErrValidation, maxDraftPromptLen)
	}

	generated, err := s.aiService.GeneratePostDraft(ctx, prompt)
	if err != nil {
		return nil, err
	}

	now := s.clock()
	draft := &domain.PostDraft{
		ApprovalID: generated.ApprovalID,
		Prompt:     prompt,
		Title:      generated.Title,
		Body:       generated.Body,
		Summary:    generated.Summary,
		Tags:       generated.Tags,
		Status:     domain.DraftStatusPending,
		AuthorID:   authorID,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	return s.draftRepo.Create(ctx, draft)
}

// ListCommunity returns pending drafts from everyone except the
// requester: the queue a reviewer acts on.
func (s *PostDraftService) ListCommunity(ctx context.Context, viewerID string, page, limit int) (*domain.PaginatedPostDrafts, error) {
	if viewerID == "" {
		return nil, domain.ErrUnauthorized
	}
	return s.draftRepo.FindPendingExceptAuthor(ctx, viewerID, page, limit)
}

// ListMine returns the requester's own drafts in every state, newest
// first; authors manage (withdraw) them from here.
func (s *PostDraftService) ListMine(ctx context.Context, authorID string, page, limit int) (*domain.PaginatedPostDrafts, error) {
	if authorID == "" {
		return nil, domain.ErrUnauthorized
	}
	return s.draftRepo.FindByAuthor(ctx, authorID, page, limit)
}

// ApproveDraft resumes the paused AI workflow and publishes the post as
// the original author. The reviewer may pass edits that are applied to
// the workflow before it resumes. The atomic status claim is what makes
// concurrent approvals safe: exactly one reviewer's call transitions
// the draft and publishes; the rest fail with ErrConflict.
func (s *PostDraftService) ApproveDraft(
	ctx context.Context, id, actorID string, review *domain.DraftReview,
) (*domain.PostDraft, error) {
	draft, err := s.authorizedDraft(ctx, id, actorID)
	if err != nil {
		return nil, err
	}

	final, err := s.aiService.ApprovePost(ctx, draft.ApprovalID, review)
	if err != nil {
		return nil, err
	}

	claimed, err := s.draftRepo.TransitionStatus(
		ctx, id, []domain.DraftStatus{domain.DraftStatusPending, domain.DraftStatusRejected},
		domain.DraftStatusApproved,
	)
	if err != nil {
		return nil, err
	}
	draft = claimed

	// The AI summary ships with the approval, so the summary worker has
	// nothing left to regenerate.
	publishedSummary := final.Summary
	post, err := s.postService.CreatePost(
		ctx, final.Title, final.Body, draft.AuthorID, final.Tags, nil, &publishedSummary,
	)
	if err != nil {
		return nil, err
	}

	draft.Status = domain.DraftStatusApproved
	draft.Title = final.Title
	draft.Body = final.Body
	draft.Summary = final.Summary
	draft.Tags = final.Tags
	draft.PostID = post.ID
	return s.draftRepo.Update(ctx, draft)
}

// RejectDraft records a rejection from a peer. Rejections stay
// resumable by design, so this is only allowed on pending drafts;
// rejecting twice is treated as idempotent success because the outcome
// is identical for every loser of the race.
func (s *PostDraftService) RejectDraft(ctx context.Context, id, actorID string, reason string) (*domain.PostDraft, error) {
	draft, err := s.authorizedDraft(ctx, id, actorID)
	if err != nil {
		return nil, err
	}
	if draft.Status == domain.DraftStatusRejected {
		return draft, nil
	}
	if draft.Status != domain.DraftStatusPending {
		return nil, fmt.Errorf("%w: approved drafts cannot be rejected", domain.ErrValidation)
	}

	if err := s.aiService.RejectPost(ctx, draft.ApprovalID, reason); err != nil {
		return nil, err
	}

	rejected, err := s.draftRepo.TransitionStatus(
		ctx, id, []domain.DraftStatus{domain.DraftStatusPending}, domain.DraftStatusRejected,
	)
	if errors.Is(err, domain.ErrConflict) {
		// Another reviewer rejected first; same outcome either way.
		return s.draftRepo.FindByID(ctx, id)
	}
	if err != nil {
		return nil, err
	}
	return rejected, nil
}

// WithdrawDraft lets the author delete their own still-pending draft.
func (s *PostDraftService) WithdrawDraft(ctx context.Context, id, actorID string) error {
	draft, err := s.draftRepo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if draft.AuthorID != actorID {
		return domain.ErrForbidden
	}
	if draft.Status != domain.DraftStatusPending {
		return fmt.Errorf("%w: only pending drafts can be withdrawn", domain.ErrValidation)
	}
	return s.draftRepo.Delete(ctx, id)
}

// authorizedDraft loads the draft and enforces the peer-review rule:
// the author can never act on their own draft.
func (s *PostDraftService) authorizedDraft(ctx context.Context, id, actorID string) (*domain.PostDraft, error) {
	if actorID == "" {
		return nil, domain.ErrUnauthorized
	}
	draft, err := s.draftRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if draft.AuthorID == actorID {
		return nil, fmt.Errorf("%w: drafts must be reviewed by another user", domain.ErrForbidden)
	}
	return draft, nil
}
