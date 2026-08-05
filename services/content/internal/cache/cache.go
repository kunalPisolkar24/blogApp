package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	PostsTTL = time.Minute
	PostTTL  = 5 * time.Minute
	TagsTTL  = 5 * time.Minute

	PostsPattern = "posts:*"
	TagsPattern  = "tags:*"
)

// Cache is a thin, best-effort Redis cache. Every call swallows errors and
// logs at debug level so the cache can never break the service.
type Cache struct {
	client *redis.Client
}

// New dials the address and returns a ready cache. It fails fast so the
// caller can decide whether to disable caching.
func New(ctx context.Context, addr string) (*Cache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:        addr,
		DialTimeout: 2 * time.Second,
	})

	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}

	return &Cache{client: client}, nil
}

func (c *Cache) Close() error {
	return c.client.Close()
}

// Get returns the cached value for key, if present and decodable.
func Get[T any](c *Cache, ctx context.Context, key string) (*T, bool) {
	if c == nil {
		return nil, false
	}

	data, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, false
	}

	var value T
	if err := json.Unmarshal(data, &value); err != nil {
		slog.Debug("cache: unmarshal failed", "key", key, "error", err)
		return nil, false
	}
	return &value, true
}

// Set stores value under key with the given ttl.
func Set(c *Cache, ctx context.Context, key string, value any, ttl time.Duration) {
	if c == nil {
		return
	}

	data, err := json.Marshal(value)
	if err != nil {
		slog.Debug("cache: marshal failed", "key", key, "error", err)
		return
	}

	if err := c.client.Set(ctx, key, data, ttl).Err(); err != nil {
		slog.Debug("cache: set failed", "key", key, "error", err)
	}
}

// Del removes a single key.
func Del(c *Cache, ctx context.Context, key string) {
	if c == nil {
		return
	}
	if err := c.client.Del(ctx, key).Err(); err != nil {
		slog.Debug("cache: del failed", "key", key, "error", err)
	}
}

// DelPattern removes every key matching the glob pattern.
func DelPattern(c *Cache, ctx context.Context, pattern string) {
	if c == nil {
		return
	}

	var keys []string
	iter := c.client.Scan(ctx, 0, pattern, 0).Iterator()
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	if err := iter.Err(); err != nil {
		slog.Debug("cache: scan failed", "pattern", pattern, "error", err)
		return
	}
	if len(keys) == 0 {
		return
	}

	if err := c.client.Del(ctx, keys...).Err(); err != nil {
		slog.Debug("cache: del failed", "pattern", pattern, "error", err)
	}
}

func KeyPost(id string) string {
	return "post:" + id
}

func KeyPosts(page, limit int) string {
	return fmt.Sprintf("posts:page:%d:limit:%d", page, limit)
}

func KeyPostsByAuthor(authorID string, page, limit int) string {
	return fmt.Sprintf("posts:author:%s:page:%d:limit:%d", authorID, page, limit)
}

func KeyPostsByTag(tag string, page, limit int) string {
	return fmt.Sprintf("posts:tag:%s:page:%d:limit:%d", tag, page, limit)
}

func KeyTags(query string, limit int) string {
	return fmt.Sprintf("tags:q:%s:limit:%d", query, limit)
}
