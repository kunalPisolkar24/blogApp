package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWithCacheNilCacheAlwaysFills(t *testing.T) {
	calls := 0
	_, err := withCache[int](nil, context.Background(), "key", time.Minute, func() (int, error) {
		calls++
		return 1, nil
	})
	require.NoError(t, err)
	_, err = withCache[int](nil, context.Background(), "key", time.Minute, func() (int, error) {
		calls++
		return 1, nil
	})
	require.NoError(t, err)
	assert.Equal(t, 2, calls)
}

func TestWithCacheHit(t *testing.T) {
	c := newMemCache(t)
	cache.Set(c, context.Background(), "key", 42, time.Minute)

	hits := testutil.ToFloat64(metrics.CacheHits)

	got, err := withCache[int](c, context.Background(), "key", time.Minute, func() (int, error) {
		t.Fatal("fill must not run on a cache hit")
		return 0, nil
	})
	require.NoError(t, err)
	assert.Equal(t, 42, got)
	assert.Equal(t, hits+1, testutil.ToFloat64(metrics.CacheHits), "a served read must count as a hit")
}

func TestWithCacheMissCountsAndFills(t *testing.T) {
	c := newMemCache(t)

	misses := testutil.ToFloat64(metrics.CacheMisses)

	got, err := withCache[int](c, context.Background(), "key", time.Minute, func() (int, error) {
		return 7, nil
	})
	require.NoError(t, err)
	assert.Equal(t, 7, got)
	assert.Equal(t, misses+1, testutil.ToFloat64(metrics.CacheMisses), "a fallen-through read must count as a miss")
}

func TestWithCacheNilCacheDoesNotCount(t *testing.T) {
	hits := testutil.ToFloat64(metrics.CacheHits)
	misses := testutil.ToFloat64(metrics.CacheMisses)

	_, err := withCache[int](nil, context.Background(), "key", time.Minute, func() (int, error) {
		return 1, nil
	})
	require.NoError(t, err)

	assert.Equal(t, hits, testutil.ToFloat64(metrics.CacheHits))
	assert.Equal(t, misses, testutil.ToFloat64(metrics.CacheMisses), "disabled caching must not pollute hit/miss metrics")
}

func TestWithCacheCoalescesConcurrentMisses(t *testing.T) {
	c := newMemCache(t)

	var mu sync.Mutex
	fills := 0
	release := make(chan struct{})
	fill := func() (int, error) {
		mu.Lock()
		fills++
		mu.Unlock()
		<-release
		return 1, nil
	}

	const callers = 6
	results := make(chan error, callers)
	for i := 0; i < callers; i++ {
		go func() {
			got, err := withCache[int](c, context.Background(), "key", time.Minute, fill)
			if err == nil && got != 1 {
				err = errors.New("unexpected result")
			}
			results <- err
		}()
	}

	time.Sleep(50 * time.Millisecond)
	close(release)

	for i := 0; i < callers; i++ {
		require.NoError(t, <-results)
	}

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 1, fills, "a burst of misses for the same key must share one fill")

	cached, ok := cache.Get[int](c, context.Background(), "key")
	require.True(t, ok)
	assert.Equal(t, 1, *cached)
}

func TestWithCacheFillAndStore(t *testing.T) {
	c := newMemCache(t)

	got, err := withCache[int](c, context.Background(), "key", time.Minute, func() (int, error) {
		return 7, nil
	})
	require.NoError(t, err)
	assert.Equal(t, 7, got)

	cached, ok := cache.Get[int](c, context.Background(), "key")
	require.True(t, ok)
	assert.Equal(t, 7, *cached)
}

func TestWithCacheFillErrorNotStored(t *testing.T) {
	c := newMemCache(t)
	wantErr := errors.New("boom")

	_, err := withCache[int](c, context.Background(), "key", time.Minute, func() (int, error) {
		return 0, wantErr
	})
	assert.ErrorIs(t, err, wantErr)

	_, ok := cache.Get[int](c, context.Background(), "key")
	assert.False(t, ok)
}

func TestInvalidate(t *testing.T) {
	c := newMemCache(t)
	ctx := context.Background()

	cache.Set(c, ctx, cache.KeyPosts(1, 10), 1, time.Minute)
	invalidate(c, ctx, cache.PostsPattern)

	_, ok := cache.Get[int](c, ctx, cache.KeyPosts(1, 10))
	assert.False(t, ok)
}
