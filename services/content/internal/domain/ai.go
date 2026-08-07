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
	Close() error
}
