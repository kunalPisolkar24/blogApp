package ai

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

// NoopAI provides local fallbacks for read paths (search, related, chat)
// while the AI service is unreachable, and is used in tests.
//
// Generation paths (summary, tags, post) have no safe local equivalent:
// fabricating content would write corrupted posts into the database, so
// they return ErrAICircuitOpen and callers retry or dead-letter instead.
type NoopAI struct{}

func NewNoopAI() *NoopAI {
	return &NoopAI{}
}

func (a *NoopAI) GenerateSummary(_ context.Context, _ string) (string, error) {
	return "", domain.ErrAICircuitOpen
}

func (a *NoopAI) GenerateTags(_ context.Context, _, _ string) ([]string, error) {
	return nil, domain.ErrAICircuitOpen
}

func (a *NoopAI) GeneratePost(_ context.Context, _ string) (*domain.GeneratedPost, error) {
	return nil, domain.ErrAICircuitOpen
}

// IndexPost and DeletePost no-op in fallback mode: search simply has no
// index while the AI service is down.
func (a *NoopAI) IndexPost(_ context.Context, _ string, _ string, _ string, _ string, _ []string, _ time.Time) error {
	return nil
}

func (a *NoopAI) DeletePost(_ context.Context, _ string) error {
	return nil
}

// SearchPosts degrades to an empty result instead of failing the request.
func (a *NoopAI) SearchPosts(_ context.Context, _ string, _ int, _ int) (*domain.SearchResult, error) {
	return &domain.SearchResult{PostIDs: nil, Total: 0}, nil
}

// RelatedPosts degrades to an empty result instead of failing the request.
func (a *NoopAI) RelatedPosts(_ context.Context, _ string, _ int) (*domain.SearchResult, error) {
	return &domain.SearchResult{PostIDs: nil, Total: 0}, nil
}

// RelatedPostsBatch degrades to an empty map, one entry per requested id.
func (a *NoopAI) RelatedPostsBatch(_ context.Context, postIDs []string, _ int) (map[string]*domain.SearchResult, error) {
	results := make(map[string]*domain.SearchResult, len(postIDs))
	for _, postID := range postIDs {
		results[postID] = &domain.SearchResult{PostIDs: nil, Total: 0}
	}
	return results, nil
}

// ChatAnswer degrades to a short notice without citations so chat remains
// available while the AI service is down.
func (a *NoopAI) ChatAnswer(_ context.Context, _ string, _ []domain.ChatTurn, _ int) (*domain.ChatAnswer, error) {
	return &domain.ChatAnswer{
		Content:      "Chat is currently unavailable in fallback mode.",
		CitedPostIDs: nil,
	}, nil
}

// Health reports the fallback as always available: NoopAI itself never
// fails, it is only selected when the primary is unavailable.
func (a *NoopAI) Health(_ context.Context) error {
	return nil
}

func (a *NoopAI) Close() error {
	return nil
}
