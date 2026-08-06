package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
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

	got, err := withCache[int](c, context.Background(), "key", time.Minute, func() (int, error) {
		t.Fatal("fill must not run on a cache hit")
		return 0, nil
	})
	require.NoError(t, err)
	assert.Equal(t, 42, got)
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
