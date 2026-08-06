package domain

import (
	"context"
)

type GeneratedPost struct {
	Title   string
	Body    string
	Summary string
	Tags    []string
}

type AIService interface {
	GenerateSummary(ctx context.Context, text string) (string, error)
	GenerateTags(ctx context.Context, title, body string) ([]string, error)
	GeneratePost(ctx context.Context, prompt string) (*GeneratedPost, error)
	Close() error
}
