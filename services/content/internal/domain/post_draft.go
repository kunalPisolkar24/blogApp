package domain

import (
	"context"
	"time"
)

// DraftStatus is the lifecycle of a human-in-the-loop post draft.
type DraftStatus string

const (
	DraftStatusPending  DraftStatus = "PENDING"
	DraftStatusApproved DraftStatus = "APPROVED"
	DraftStatusRejected DraftStatus = "REJECTED"
)

type PostDraft struct {
	ID         string      `bson:"_id,omitempty" json:"id,omitempty"`
	ApprovalID string      `bson:"approvalId" json:"approvalId"`
	Prompt     string      `bson:"prompt" json:"prompt"`
	Title      string      `bson:"title" json:"title"`
	Body       string      `bson:"body" json:"body"`
	Summary    string      `bson:"summary" json:"summary"`
	Tags       []string    `bson:"tags" json:"tags"`
	Status     DraftStatus `bson:"status" json:"status"`
	AuthorID   string      `bson:"authorId" json:"authorId"`
	// PostID is set once a peer approval published this draft as a post.
	PostID    string    `bson:"postId,omitempty" json:"postId,omitempty"`
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// DraftReview carries optional reviewer edits applied before an approval
// resumes the AI workflow; nil fields keep the generated values.
type DraftReview struct {
	Title   *string
	Body    *string
	Summary *string
	Tags    []string
}

type PaginatedPostDrafts struct {
	Drafts      []*PostDraft
	TotalPages  int
	TotalDrafts int64
	Page        int
}

type PostDraftRepository interface {
	Create(ctx context.Context, draft *PostDraft) (*PostDraft, error)
	FindByID(ctx context.Context, id string) (*PostDraft, error)
	// FindPendingExceptAuthor backs the community review queue: pending
	// drafts from everyone except the requester, newest first.
	FindPendingExceptAuthor(ctx context.Context, authorID string, page, limit int) (*PaginatedPostDrafts, error)
	FindByAuthor(ctx context.Context, authorID string, page, limit int) (*PaginatedPostDrafts, error)
	// TransitionStatus atomically moves a draft from any of the given
	// statuses to target and returns the updated document. It fails with
	// ErrConflict when the draft has already moved on, which is what
	// keeps a concurrent double-approval from publishing twice.
	TransitionStatus(ctx context.Context, id string, from []DraftStatus, to DraftStatus) (*PostDraft, error)
	Update(ctx context.Context, draft *PostDraft) (*PostDraft, error)
	Delete(ctx context.Context, id string) error
}
