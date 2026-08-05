package ai

import (
	"context"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

// NoopAI is a placeholder implementation used until the real gRPC
// client to the AI service is wired up.
type NoopAI struct{}

func NewNoopAI() *NoopAI {
	return &NoopAI{}
}

func (a *NoopAI) GenerateSummary(ctx context.Context, text string) (string, error) {
	return "auto-generated summary", nil
}

func (a *NoopAI) GenerateTags(ctx context.Context, title, body string) ([]string, error) {
	return []string{"go", "graphql"}, nil
}

func (a *NoopAI) GeneratePost(ctx context.Context, prompt string) (*domain.GeneratedPost, error) {
	return &domain.GeneratedPost{
		Title:   "Generated post",
		Body:    "Generated body for: " + prompt,
		Summary: "auto-generated summary",
		Tags:    []string{"go", "graphql"},
	}, nil
}
