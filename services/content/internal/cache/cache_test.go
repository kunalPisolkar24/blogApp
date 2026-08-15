package cache

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestCache(t *testing.T) (*Cache, *miniredis.Miniredis) {
	t.Helper()

	mr := miniredis.RunT(t)
	c, err := New(context.Background(), Options{Addr: mr.Addr()})
	require.NoError(t, err)
	t.Cleanup(func() { c.Close() })
	return c, mr
}

type item struct {
	Name string
	N    int
}

func TestGetSetRoundTrip(t *testing.T) {
	c, _ := newTestCache(t)
	ctx := context.Background()

	Set(c, ctx, "key", item{Name: "x", N: 1}, time.Minute)

	got, ok := Get[item](c, ctx, "key")
	require.True(t, ok)
	assert.Equal(t, item{Name: "x", N: 1}, *got)
}

func TestGetMiss(t *testing.T) {
	c, _ := newTestCache(t)

	_, ok := Get[item](c, context.Background(), "missing")
	assert.False(t, ok)
}

func TestGetCorruptValue(t *testing.T) {
	c, mr := newTestCache(t)
	mr.Set("key", "{not json")

	_, ok := Get[item](c, context.Background(), "key")
	assert.False(t, ok)
}

func TestSetUndecodableValueIsNoop(t *testing.T) {
	c, mr := newTestCache(t)
	ctx := context.Background()

	Set(c, ctx, "key", make(chan int), time.Minute)
	got, _ := mr.Get("key")
	assert.Equal(t, "", got)
}

func TestDel(t *testing.T) {
	c, mr := newTestCache(t)
	ctx := context.Background()

	Set(c, ctx, "key", item{}, time.Minute)
	Del(c, ctx, "key")

	got, _ := mr.Get("key")
	assert.Equal(t, "", got)
}

func TestDelPattern(t *testing.T) {
	c, mr := newTestCache(t)
	ctx := context.Background()

	Set(c, ctx, "posts:1", item{}, time.Minute)
	Set(c, ctx, "posts:2", item{}, time.Minute)
	Set(c, ctx, "tags:1", item{}, time.Minute)

	DelPattern(c, ctx, PostsPattern)

	p1, _ := mr.Get("posts:1")
	p2, _ := mr.Get("posts:2")
	t1, _ := mr.Get("tags:1")
	assert.Equal(t, "", p1)
	assert.Equal(t, "", p2)
	assert.NotEqual(t, "", t1)
}

func TestDelPatternNoMatches(t *testing.T) {
	c, _ := newTestCache(t)
	DelPattern(c, context.Background(), "posts:*")
}

func TestNilCacheIsNoop(t *testing.T) {
	ctx := context.Background()

	_, ok := Get[item](nil, ctx, "key")
	assert.False(t, ok)

	Set(nil, ctx, "key", item{}, time.Minute)
	Del(nil, ctx, "key")
	DelPattern(nil, ctx, "posts:*")
}

func TestRedisUnreachable(t *testing.T) {
	_, err := New(context.Background(), Options{Addr: "localhost:1"})
	require.Error(t, err)
}

func TestSentinelsUnreachable(t *testing.T) {
	_, err := New(context.Background(), Options{
		MasterName: "mymaster",
		Sentinels:  []string{"localhost:1"},
	})
	require.Error(t, err)
}

func TestClientOptionsAreExplicit(t *testing.T) {
	opts := newClient(Options{Addr: "localhost:6379"}).Options()
	assert.Equal(t, dialTimeout, opts.DialTimeout)
	assert.Equal(t, commandTimeout, opts.ReadTimeout)
	assert.Equal(t, commandTimeout, opts.WriteTimeout)
	assert.Equal(t, maxRetries, opts.MaxRetries)
	assert.Equal(t, minRetryBackoff, opts.MinRetryBackoff)
	assert.Equal(t, maxRetryBackoff, opts.MaxRetryBackoff)
}

func TestClientOptionsAreExplicitForSentinels(t *testing.T) {
	client := newClient(Options{MasterName: "mymaster", Sentinels: []string{"localhost:26379"}})
	assert.NotNil(t, client)
}

func TestCacheErrorsAreCounted(t *testing.T) {
	c, mr := newTestCache(t)
	ctx := context.Background()

	before := testutil.ToFloat64(metrics.CacheErrorsTotal)

	mr.Close()

	Set(c, ctx, "key", item{}, time.Minute)
	Del(c, ctx, "key")
	DelPattern(c, ctx, "posts:*")
	_, _ = Get[item](c, ctx, "key")

	after := testutil.ToFloat64(metrics.CacheErrorsTotal)
	assert.Greater(t, after, before, "redis failures must be visible in content_cache_errors_total")
}

func TestMissIsNotACacheError(t *testing.T) {
	c, _ := newTestCache(t)

	before := testutil.ToFloat64(metrics.CacheErrorsTotal)

	_, ok := Get[item](c, context.Background(), "missing")
	assert.False(t, ok)

	assert.Equal(t, before, testutil.ToFloat64(metrics.CacheErrorsTotal), "a normal miss is not an error")
}

func TestCoalesceRunsFillOnce(t *testing.T) {
	c, _ := newTestCache(t)

	var fills atomic.Int32
	release := make(chan struct{})
	fill := func() (int, error) {
		fills.Add(1)
		<-release
		return 1, nil
	}

	const callers = 8
	start := make(chan struct{})
	var ready sync.WaitGroup
	ready.Add(callers)
	results := make(chan error, callers)
	for i := 0; i < callers; i++ {
		go func() {
			ready.Done()
			<-start
			got, err := Coalesce(c, "key", fill)
			if err == nil && got != 1 {
				err = errors.New("unexpected result")
			}
			results <- err
		}()
	}
	ready.Wait()
	close(start)
	time.Sleep(20 * time.Millisecond)
	close(release)

	for i := 0; i < callers; i++ {
		require.NoError(t, <-results)
	}
	assert.Equal(t, int32(1), fills.Load(), "concurrent misses must share a single fill")
}

func TestCoalesceSharesErrors(t *testing.T) {
	c, _ := newTestCache(t)

	wantErr := errors.New("boom")
	release := make(chan struct{})
	var calls atomic.Int32
	fill := func() (int, error) {
		calls.Add(1)
		<-release
		return 0, wantErr
	}

	const callers = 4
	start := make(chan struct{})
	var ready sync.WaitGroup
	ready.Add(callers)
	errs := make(chan error, callers)
	for i := 0; i < callers; i++ {
		go func() {
			ready.Done()
			<-start
			_, err := Coalesce(c, "key", fill)
			errs <- err
		}()
	}
	ready.Wait()
	close(start)
	time.Sleep(20 * time.Millisecond)
	close(release)

	for i := 0; i < callers; i++ {
		assert.ErrorIs(t, <-errs, wantErr)
	}
	assert.Equal(t, int32(1), calls.Load(), "concurrent callers must share a single failed fill")
}

func TestCoalesceFreshFillAfterCompletion(t *testing.T) {
	c, _ := newTestCache(t)

	first := true
	fills := 0
	fill := func() (int, error) {
		fills++
		if first {
			first = false
			return 1, nil
		}
		return 2, nil
	}

	got, err := Coalesce(c, "key", fill)
	require.NoError(t, err)
	assert.Equal(t, 1, got)

	got, err = Coalesce(c, "key", fill)
	require.NoError(t, err)
	assert.Equal(t, 2, got)
	assert.Equal(t, 2, fills, "a later call must start a fresh fill")
}

func TestCoalesceNilCacheRunsFill(t *testing.T) {
	fills := 0
	got, err := Coalesce[int](nil, "key", func() (int, error) {
		fills++
		return 3, nil
	})
	require.NoError(t, err)
	assert.Equal(t, 3, got)
	assert.Equal(t, 1, fills)
}

func TestKeys(t *testing.T) {
	assert.Equal(t, "post:abc", KeyPost("abc"))
	assert.Equal(t, "posts:page:2:limit:10", KeyPosts(2, 10))
	assert.Equal(t, "posts:author:u:page:1:limit:5", KeyPostsByAuthor("u", 1, 5))
	assert.Equal(t, "posts:tag:go:page:1:limit:5", KeyPostsByTag("go", 1, 5))
	assert.Equal(t, "tags:q:go:limit:5", KeyTags("go", 5))
}
