package cache

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
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

func TestKeys(t *testing.T) {
	assert.Equal(t, "post:abc", KeyPost("abc"))
	assert.Equal(t, "posts:page:2:limit:10", KeyPosts(2, 10))
	assert.Equal(t, "posts:author:u:page:1:limit:5", KeyPostsByAuthor("u", 1, 5))
	assert.Equal(t, "posts:tag:go:page:1:limit:5", KeyPostsByTag("go", 1, 5))
	assert.Equal(t, "tags:q:go:limit:5", KeyTags("go", 5))
}
