package service

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
)

// withCache returns the cached value when present, otherwise runs fill,
// stores the result, and returns it. Concurrent misses for the same key
// are coalesced into a single fill (single-flight), so a burst of
// requests right after expiry or invalidation cannot stampede the
// underlying store. Caching is skipped entirely when the cache is nil
// (disabled).
func withCache[T any](c *cache.Cache, ctx context.Context, key string, ttl time.Duration, fill func() (T, error)) (T, error) {
	if c == nil {
		return fill()
	}

	if cached, ok := cache.Get[T](c, ctx, key); ok {
		metrics.CacheHits.Inc()
		return *cached, nil
	}
	metrics.CacheMisses.Inc()

	result, err := cache.Coalesce[T](c, key, fill)
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
