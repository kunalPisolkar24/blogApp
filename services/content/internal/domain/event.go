package domain

import (
	"context"
	"time"
)

type PostEventPayload struct {
	PostID        string    `json:"postId"`
	Title         string    `json:"title"`
	Body          string    `json:"body"`
	ImageURL      *string   `json:"imageUrl"`
	Summary       string    `json:"summary,omitempty"`
	SummaryStatus string    `json:"summaryStatus,omitempty"`
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
