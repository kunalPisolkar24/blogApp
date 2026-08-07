package ai

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

// NoopAI generates content locally from the input. It is used as the
// fallback when the AI service is unreachable, and in tests.
type NoopAI struct{}

func NewNoopAI() *NoopAI {
	return &NoopAI{}
}

var tokenSplitRegex = regexp.MustCompile(`[^a-z0-9]+`)

var stopWords = map[string]struct{}{
	"the": {}, "and": {}, "for": {}, "with": {}, "this": {}, "that": {}, "from": {}, "into": {}, "about": {}, "your": {},
	"you": {}, "are": {}, "was": {}, "were": {}, "will": {}, "have": {}, "has": {}, "had": {}, "not": {}, "but": {},
	"can": {}, "could": {}, "should": {}, "would": {}, "our": {}, "their": {}, "they": {}, "them": {}, "his": {}, "her": {},
	"its": {}, "who": {}, "what": {}, "when": {}, "where": {}, "why": {}, "how": {}, "all": {}, "any": {}, "new": {},
	"post": {}, "blog": {}, "content": {}, "article": {}, "write": {}, "create": {}, "generate": {},
}

func (a *NoopAI) GenerateSummary(_ context.Context, text string) (string, error) {
	summary := truncate(normalizeWhitespace(text), 240)
	if summary == "" {
		return "Summary is currently unavailable.", nil
	}
	return summary, nil
}

func (a *NoopAI) GenerateTags(_ context.Context, title, body string) ([]string, error) {
	return deriveTags(title, body), nil
}

func (a *NoopAI) GeneratePost(_ context.Context, prompt string) (*domain.GeneratedPost, error) {
	normalized := normalizeWhitespace(prompt)
	title := truncate(normalized, 64)
	if title == "" {
		title = "Generated Post"
	}

	body := normalized
	if body == "" {
		body = "Content generation is currently running in fallback mode."
	}

	return &domain.GeneratedPost{
		Title:   title,
		Body:    body,
		Summary: truncate(body, 220),
		Tags:    deriveTags(title, body),
	}, nil
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

func (a *NoopAI) Close() error {
	return nil
}

func deriveTags(title, body string) []string {
	text := strings.ToLower(title + " " + body)
	tokens := tokenSplitRegex.Split(text, -1)
	seen := make(map[string]struct{})
	tags := make([]string, 0, 5)

	for _, token := range tokens {
		if len(token) < 3 {
			continue
		}
		if _, blocked := stopWords[token]; blocked {
			continue
		}
		if _, exists := seen[token]; exists {
			continue
		}
		seen[token] = struct{}{}
		tags = append(tags, token)
		if len(tags) == 5 {
			break
		}
	}

	if len(tags) == 0 {
		return []string{"general"}
	}
	return tags
}

func normalizeWhitespace(input string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(input)), " ")
}

func truncate(input string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(input)
	if len(runes) <= max {
		return input
	}
	cut := string(runes[:max])
	if idx := strings.LastIndex(cut, " "); idx > 0 {
		cut = cut[:idx]
	}
	return strings.TrimSpace(cut) + "..."
}
