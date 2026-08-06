package service

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
)

// withCache returns the cached value when present, otherwise runs fill,
// stores the result, and returns it. Caching is skipped entirely when
// the cache is nil (disabled).
func withCache[T any](c *cache.Cache, ctx context.Context, key string, ttl time.Duration, fill func() (T, error)) (T, error) {
	if cached, ok := cache.Get[T](c, ctx, key); ok {
		return *cached, nil
	}

	result, err := fill()
	if err != nil {
		return result, err
	}

	cache.Set(c, ctx, key, result, ttl)
	return result, nil
}

// invalidate drops every key matching the given patterns.
func invalidate(c *cache.Cache, ctx context.Context, patterns ...string) {
	for _, pattern := range patterns {
		cache.DelPattern(c, ctx, pattern)
	}
}
