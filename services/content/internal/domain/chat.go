package domain

import (
	"context"
	"time"
)

type Chat struct {
	ID        string    `bson:"_id,omitempty" json:"id,omitempty"`
	UserID    string    `bson:"userId" json:"userId"`
	Title     string    `bson:"title" json:"title"`
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// ChatMessageRole distinguishes user prompts from assistant replies.
type ChatMessageRole string

const (
	ChatMessageRoleUser      ChatMessageRole = "user"
	ChatMessageRoleAssistant ChatMessageRole = "assistant"
)

// ChatMessage is a single exchange in a chat. CitedPostIDs lists the posts
// the AI answer was grounded on, and is empty for user messages.
type ChatMessage struct {
	ID           string          `bson:"_id,omitempty" json:"id,omitempty"`
	ChatID       string          `bson:"chatId" json:"chatId"`
	Role         ChatMessageRole `bson:"role" json:"role"`
	Content      string          `bson:"content" json:"content"`
	CitedPostIDs []string        `bson:"citedPostIds,omitempty" json:"citedPostIds,omitempty"`
	CreatedAt    time.Time       `bson:"createdAt" json:"createdAt"`
}

// ChatTurn is one history entry sent to the AI service as conversation
// context. The most recent turns (user and assistant) are forwarded so the
// answer can reference earlier messages.
type ChatTurn struct {
	Role    ChatMessageRole
	Content string
}

// ChatAnswer is the AI response to a query, with the posts it cited.
type ChatAnswer struct {
	Content      string
	CitedPostIDs []string
}

type PaginatedMessages struct {
	Messages      []*ChatMessage
	TotalMessages int64
	TotalPages    int
	Page          int
}

type ChatRepository interface {
	Create(ctx context.Context, chat *Chat) (*Chat, error)
	FindByID(ctx context.Context, id string) (*Chat, error)
	ListByUser(ctx context.Context, userID string) ([]*Chat, error)
	Rename(ctx context.Context, id string, title string) (*Chat, error)
	Delete(ctx context.Context, id string) error
	AddMessage(ctx context.Context, msg *ChatMessage) (*ChatMessage, error)
	Messages(ctx context.Context, chatID string, page, limit int) (*PaginatedMessages, error)
}
