package domain

import (
	"context"
	"time"
)

// EventType distinguishes structurally identical post events so
// consumers can tell a new post from an update.
type EventType string

const (
	EventTypePostCreated EventType = "post.created"
	EventTypePostUpdated EventType = "post.updated"
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

type EventPublisher interface {
	PublishPostCreated(ctx context.Context, post *Post) error
	PublishPostUpdated(ctx context.Context, post *Post) error
	PublishPostDeleted(ctx context.Context, id string) error
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
