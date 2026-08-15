// Package pagination provides the single page/limit normalization used
// by both the service and repository layers so queries and cache keys
// always agree, regardless of how callers spell the arguments.
package pagination

const (
	// DefaultLimit is applied when limit is missing or out of range.
	DefaultLimit = 10
	// MaxLimit caps a single page size.
	MaxLimit = 100
	// MaxPage caps the page number: it bounds the skip offset, keeps
	// (page-1)*limit free of integer overflow, and bounds the Redis
	// cache-key space for list endpoints.
	MaxPage = 1000
)

// Normalize clamps page into [1, MaxPage] and limit into [1, MaxLimit],
// defaulting both when they are out of range.
func Normalize(page, limit int) (int, int) {
	if page < 1 {
		page = 1
	}
	if page > MaxPage {
		page = MaxPage
	}
	if limit < 1 {
		limit = DefaultLimit
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}
	return page, limit
}
