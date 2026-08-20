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

// Weight is the signal strength of the interaction for personalization:
// views are weak signals, likes stronger, saves the strongest. The
// weights are fixed for now and configurable via env later.
func (k PostInteractionKind) Weight() int {
	switch k {
	case PostInteractionLike:
		return 3
	case PostInteractionSave:
		return 5
	default:
		return 1
	}
}

// PostInteraction records a single user interaction (view, like or save)
// with a post. It is the raw material feed personalization runs on.
// Mode is the recommendation feed the post was shown in ("" when there
// is none); it is event-only metadata, never persisted.
type PostInteraction struct {
	ID        string              `bson:"_id,omitempty" json:"id,omitempty"`
	UserID    string              `bson:"userId" json:"userId"`
	PostID    string              `bson:"postId" json:"postId"`
	Kind      PostInteractionKind `bson:"kind" json:"kind"`
	Mode      RecommendMode       `bson:"-" json:"mode,omitempty"`
	CreatedAt time.Time           `bson:"createdAt" json:"createdAt"`
}

type PaginatedPostInteractions struct {
	Interactions      []*PostInteraction
	TotalInteractions int64
	TotalPages        int
	Page              int
}

// PostInteractionState is the like/save state of a user with a post.
// It is what the likedByMe/savedByMe Post fields are resolved from.
type PostInteractionState struct {
	Liked bool
	Saved bool
}

type PostInteractionRepository interface {
	Record(ctx context.Context, interaction *PostInteraction) (*PostInteraction, error)
	FindByID(ctx context.Context, id string) (*PostInteraction, error)
	// FindByUserPostAndKind returns the interaction of a user with a
	// post, or ErrNotFound when the user has not interacted that way.
	FindByUserPostAndKind(ctx context.Context, userID, postID string, kind PostInteractionKind) (*PostInteraction, error)
	Delete(ctx context.Context, id string) error
	ListByUser(ctx context.Context, userID string, page, limit int) (*PaginatedPostInteractions, error)
	// ListStates returns the like/save state of a user for every given
	// post. Posts the user never interacted with are absent from the map.
	ListStates(ctx context.Context, userID string, postIDs []string) (map[string]PostInteractionState, error)
}
