package domain

import (
	"context"
	"time"
)

// EventType distinguishes structurally identical post events so
// consumers can tell a new post from an update.
type EventType string

const (
	EventTypePostCreated    EventType = "post.created"
	EventTypePostUpdated    EventType = "post.updated"
	EventTypeUserInteracted EventType = "user.interacted"
)

type PostEventPayload struct {
	PostID        string    `json:"postId"`
	EventType     EventType `json:"eventType"`
	Title         string    `json:"title"`
	Body          string    `json:"body"`
	ImageURL      *string   `json:"imageUrl"`
	Summary       string    `json:"summary,omitempty"`
	SummaryStatus string    `json:"summaryStatus,omitempty"`
	Tags          []string  `json:"tags,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}

// UserInteractedPayload is the event published on the dedicated
// user-interacted topic whenever a user views, likes or saves a post.
// Weight is the signal strength of the interaction (see
// PostInteractionKind.Weight). Mode is the recommendation feed the post
// was shown in, or empty when there was no feed attribution; it feeds
// the M5 recommender evals, the personalizer ignores it.
type UserInteractedPayload struct {
	UserID string              `json:"userId"`
	PostID string              `json:"postId"`
	Kind   PostInteractionKind `json:"kind"`
	Weight int                 `json:"weight"`
	Mode   RecommendMode       `json:"mode,omitempty"`
}

type EventPublisher interface {
	PublishPostCreated(ctx context.Context, post *Post) error
	PublishPostUpdated(ctx context.Context, post *Post) error
	PublishPostDeleted(ctx context.Context, id string) error
	PublishUserInteracted(ctx context.Context, interaction *PostInteraction) error
}

type DLQPublisher interface {
	PublishDeadLetter(ctx context.Context, originalTopic, dlqTopic string, key, value []byte, err error) error
}

type EventProducer interface {
	EventPublisher
	DLQPublisher
	Ping(ctx context.Context) error
	Close() error
}
