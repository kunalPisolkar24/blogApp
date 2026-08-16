package domain

import (
	"context"
	"time"
)

// PostInteractionKind is the type of a user interaction with a post.
type PostInteractionKind string

const (
	PostInteractionView PostInteractionKind = "view"
	PostInteractionLike PostInteractionKind = "like"
	PostInteractionSave PostInteractionKind = "save"
)

// PostInteraction records a single user interaction (view, like or save)
// with a post. It is the raw material feed personalization runs on.
type PostInteraction struct {
	ID        string              `bson:"_id,omitempty" json:"id,omitempty"`
	UserID    string              `bson:"userId" json:"userId"`
	PostID    string              `bson:"postId" json:"postId"`
	Kind      PostInteractionKind `bson:"kind" json:"kind"`
	CreatedAt time.Time           `bson:"createdAt" json:"createdAt"`
}

type PaginatedPostInteractions struct {
	Interactions      []*PostInteraction
	TotalInteractions int64
	TotalPages        int
	Page              int
}

type PostInteractionRepository interface {
	Record(ctx context.Context, interaction *PostInteraction) (*PostInteraction, error)
	FindByID(ctx context.Context, id string) (*PostInteraction, error)
	Delete(ctx context.Context, id string) error
	ListByUser(ctx context.Context, userID string, page, limit int) (*PaginatedPostInteractions, error)
}
