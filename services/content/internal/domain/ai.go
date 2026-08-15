package domain

import (
	"context"
	"time"
)

type GeneratedPost struct {
	Title   string
	Body    string
	Summary string
	Tags    []string
}

type SearchResult struct {
	PostIDs []string
	Total   int
}

type AIService interface {
	GenerateSummary(ctx context.Context, text string) (string, error)
	GenerateTags(ctx context.Context, title, body string) ([]string, error)
	GeneratePost(ctx context.Context, prompt string) (*GeneratedPost, error)
	IndexPost(ctx context.Context, postID, title, body, summary string, tags []string, createdAt time.Time) error
	DeletePost(ctx context.Context, postID string) error
	SearchPosts(ctx context.Context, query string, offset, limit int) (*SearchResult, error)
	RelatedPosts(ctx context.Context, postID string, limit int) (*SearchResult, error)
	// RelatedPostsBatch resolves related posts for several post ids in
	// one RPC, keyed by the requested post id, so list pages do not
	// fire one AI call per post.
	RelatedPostsBatch(ctx context.Context, postIDs []string, limit int) (map[string]*SearchResult, error)
	ChatAnswer(ctx context.Context, query string, history []ChatTurn, topK int) (*ChatAnswer, error)
	// Health reports whether the AI service can do real work: the
	// connection is ready and no circuit breaker is open. It must not
	// make RPCs.
	Health(ctx context.Context) error
	Close() error
}
