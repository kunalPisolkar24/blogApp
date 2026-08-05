package domain

import (
	"context"
	"time"
)

type PostStatus string

const (
	PostStatusPending   PostStatus = "PENDING"
	PostStatusCompleted PostStatus = "COMPLETED"
	PostStatusFailed    PostStatus = "FAILED"
)

type Post struct {
	ID            string     `bson:"_id,omitempty" json:"id,omitempty"`
	Title         string     `bson:"title" json:"title"`
	Body          string     `bson:"body" json:"body"`
	Slug          string     `bson:"slug" json:"slug"`
	ImageUrl      *string    `bson:"imageUrl" json:"imageUrl,omitempty"`
	AuthorID      string     `bson:"authorId" json:"authorId"`
	Tags          []string   `bson:"tags" json:"tags"`
	Summary       string     `bson:"summary" json:"summary"`
	SummaryStatus PostStatus `bson:"summaryStatus" json:"summaryStatus"`
	CreatedAt     time.Time  `bson:"createdAt" json:"createdAt"`
	UpdatedAt     time.Time  `bson:"updatedAt" json:"updatedAt"`
	ResetSummary  bool       `bson:"-" json:"-"`
}

type PaginatedPosts struct {
	Posts      []*Post `json:"posts"`
	TotalPages int     `json:"totalPages"`
	TotalPosts int64   `json:"totalPosts"`
	Page       int     `json:"page"`
}

type PostRepository interface {
	Create(ctx context.Context, post *Post) (*Post, error)
	Update(ctx context.Context, id string, post *Post) (*Post, error)
	UpdateSummary(ctx context.Context, id string, summary string, status PostStatus) error
	Delete(ctx context.Context, id string) error
	FindAll(ctx context.Context, page, limit int) (*PaginatedPosts, error)
	FindByID(ctx context.Context, id string) (*Post, error)
	FindByAuthor(ctx context.Context, authorID string, page, limit int) (*PaginatedPosts, error)
	FindByTag(ctx context.Context, tag string, page, limit int) (*PaginatedPosts, error)
}

type SummaryProcessor interface {
	GetPost(ctx context.Context, id string) (*Post, error)
	SetPostSummary(ctx context.Context, id, summary string, status PostStatus) error
}
