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

// GeneratedDraft is a paused human-in-the-loop draft: the generated
// payload plus the approval id used to resume or reject the workflow.
type GeneratedDraft struct {
	GeneratedPost
	ApprovalID string
}

type SearchResult struct {
	PostIDs []string
	Total   int
	// Reasons maps post id -> evidence line from the user's real
	// interaction profile; posts without evidence are absent.
	Reasons map[string]string
}

// RecommendMode selects how a feed is ranked for a user: DEFAULT follows
// the user's learned taste, SURPRISE deliberately strays from it.
type RecommendMode string

const (
	RecommendModeDefault  RecommendMode = "default"
	RecommendModeSurprise RecommendMode = "surprise"
)

type AIService interface {
	GenerateSummary(ctx context.Context, text string) (string, error)
	GenerateTags(ctx context.Context, title, body string) ([]string, error)
	GeneratePost(ctx context.Context, prompt string) (*GeneratedPost, error)
	// GeneratePostDraft produces a paused draft and returns its approval
	// id; ApprovePost resumes it (with optional reviewer edits) into the
	// final payload, RejectPost records a rejection.
	GeneratePostDraft(ctx context.Context, prompt string) (*GeneratedDraft, error)
	ApprovePost(ctx context.Context, approvalID string, review *DraftReview) (*GeneratedPost, error)
	RejectPost(ctx context.Context, approvalID string, reason string) error
	IndexPost(ctx context.Context, postID, title, body, summary string, tags []string, createdAt time.Time) error
	DeletePost(ctx context.Context, postID string) error
	SearchPosts(ctx context.Context, query string, offset, limit int) (*SearchResult, error)
	RelatedPosts(ctx context.Context, postID string, limit int) (*SearchResult, error)
	// RelatedPostsBatch resolves related posts for several post ids in
	// one RPC, keyed by the requested post id, so list pages do not
	// fire one AI call per post.
	RelatedPostsBatch(ctx context.Context, postIDs []string, limit int) (map[string]*SearchResult, error)
	ChatAnswer(ctx context.Context, threadID, query string, history []ChatTurn, topK int) (*ChatAnswer, error)
	// UpdateUserProfile folds an interaction into the user's interest
	// profile so future feeds can be ranked by it.
	UpdateUserProfile(ctx context.Context, userID, postID string, kind PostInteractionKind) error
	// RecommendFeed ranks posts for a user by their learned taste.
	// A user with no profile yet yields an empty result.
	RecommendFeed(ctx context.Context, userID string, offset, limit int, mode RecommendMode, seed uint32) (*SearchResult, error)
	DeleteUserProfile(ctx context.Context, userID string) error
	// Health reports whether the AI service can do real work: the
	// connection is ready and no circuit breaker is open. It must not
	// make RPCs.
	Health(ctx context.Context) error
	Close() error
}
