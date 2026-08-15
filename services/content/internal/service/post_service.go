package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
	"github.com/kunalPisolkar24/topos/services/content/internal/middleware"
	"github.com/kunalPisolkar24/topos/services/content/internal/pagination"
	"github.com/kunalPisolkar24/topos/services/content/internal/slug"
	"go.mongodb.org/mongo-driver/mongo"
)

// Input limits for post writes. The title cap keeps generated slugs well
// under Mongo's 1024-byte index key limit; the body cap stays far below
// the 16MB BSON document limit.
const (
	maxSlugRetries = 5
	maxTitleLen    = 200
	maxBodyLen     = 1 << 20 // 1 MiB
	maxTagCount    = 20
	maxTagLen      = 64
)

type PostService struct {
	postRepo       domain.PostRepository
	tagRepo        domain.TagRepository
	aiService      domain.AIService
	eventPublisher domain.EventPublisher
	cache          *cache.Cache
	clock          func() time.Time
}

func NewPostService(postRepo domain.PostRepository, tagRepo domain.TagRepository, aiService domain.AIService, eventPublisher domain.EventPublisher, cacheClient *cache.Cache) *PostService {
	return &PostService{
		postRepo:       postRepo,
		tagRepo:        tagRepo,
		aiService:      aiService,
		eventPublisher: eventPublisher,
		cache:          cacheClient,
		clock:          time.Now,
	}
}

func (s *PostService) CreatePost(ctx context.Context, title, body, authorID string, tags []string, imageUrl *string, summary *string) (*domain.Post, error) {
	title, err := normalizeTitle(title)
	if err != nil {
		return nil, err
	}
	body, err = normalizeBody(body)
	if err != nil {
		return nil, err
	}
	tags, err = normalizeTags(tags)
	if err != nil {
		return nil, err
	}

	summaryValue := ""
	summaryStatus := domain.PostStatusPending
	if summary != nil {
		if trimmed := strings.TrimSpace(*summary); trimmed != "" {
			summaryValue = trimmed
			summaryStatus = domain.PostStatusCompleted
		}
	}

	var lastErr error
	for attempt := 0; attempt < maxSlugRetries; attempt++ {
		// A fresh timestamp per attempt regenerates the slug, so a
		// collision on the previous attempt gets a new suffix instead
		// of failing identically forever.
		now := s.clock()
		post := &domain.Post{
			Title:         title,
			Body:          body,
			Slug:          slug.Generate(title, now),
			AuthorID:      authorID,
			Tags:          tags,
			ImageUrl:      imageUrl,
			Summary:       summaryValue,
			SummaryStatus: summaryStatus,
			CreatedAt:     now,
			UpdatedAt:     now,
		}

		if err := s.ensureSlugAvailable(ctx, post.Slug); err != nil {
			if !errors.Is(err, domain.ErrValidation) {
				return nil, err
			}
			lastErr = err
			slog.Warn("slug collision, retrying with a fresh timestamp", "slug", post.Slug, "attempt", attempt)
			continue
		}

		created, err := s.postRepo.Create(ctx, post)
		if err == nil {
			s.ensureTags(ctx, created.ID, tags)
			invalidate(s.cache, ctx, cache.PostsPattern, cache.TagsPattern, cache.SearchPattern, cache.RelatedPattern)
			metrics.PostsCreated.Inc()
			if s.eventPublisher != nil {
				s.publishEvent(ctx, "post created", created.ID, s.eventPublisher.PublishPostCreated, created)
			}
			return created, nil
		}
		if !isDuplicateKey(err) {
			return nil, err
		}
		lastErr = err
	}
	return nil, fmt.Errorf("failed to create post after %d slug retries: %w", maxSlugRetries, lastErr)
}

// ensureSlugAvailable rejects a slug that another post already owns.
// The duplicate-key index remains the final authority; this check just
// turns the common collision into a clear validation error instead of
// exhausting the retry loop.
func (s *PostService) ensureSlugAvailable(ctx context.Context, slugValue string) error {
	existing, err := s.postRepo.FindBySlug(ctx, slugValue)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil
		}
		return err
	}
	if existing != nil {
		return fmt.Errorf("%w: slug %q is already taken", domain.ErrValidation, slugValue)
	}
	return nil
}

func (s *PostService) UpdatePost(ctx context.Context, id, actorID string, title, body *string, tags []string, imageUrl *string) (*domain.Post, error) {
	existing, err := s.postRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing.AuthorID != actorID {
		return nil, domain.ErrForbidden
	}

	post := &domain.Post{UpdatedAt: s.clock()}

	if title != nil {
		trimmed, err := normalizeTitle(*title)
		if err != nil {
			return nil, err
		}
		if trimmed != existing.Title {
			post.Title = trimmed
			post.Slug = slug.Generate(trimmed, post.UpdatedAt)
			post.MarkSummaryStale()
		}
	}
	if body != nil {
		trimmed, err := normalizeBody(*body)
		if err != nil {
			return nil, err
		}
		if trimmed != existing.Body {
			post.Body = trimmed
			post.MarkSummaryStale()
		}
	}
	if imageUrl != nil {
		post.ImageUrl = imageUrl
	}
	if tags != nil {
		cleaned, err := normalizeTags(tags)
		if err != nil {
			return nil, err
		}
		post.Tags = cleaned
	}

	updated, err := s.postRepo.Update(ctx, id, post)
	if err == nil {
		s.ensureTags(ctx, updated.ID, post.Tags)
		s.invalidatePost(ctx, id)
		metrics.PostsUpdated.Inc()
		if s.eventPublisher != nil {
			s.publishEvent(ctx, "post updated", updated.ID, s.eventPublisher.PublishPostUpdated, updated)
		}
	}
	return updated, err
}

func (s *PostService) DeletePost(ctx context.Context, id, actorID string) error {
	existing, err := s.postRepo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if existing.AuthorID != actorID {
		return domain.ErrForbidden
	}
	if err := s.postRepo.Delete(ctx, id); err != nil {
		return err
	}
	s.invalidatePost(ctx, id)
	metrics.PostsDeleted.Inc()
	if s.eventPublisher != nil {
		s.publishEvent(ctx, "post deleted", id, func(ctx context.Context, _ *domain.Post) error {
			return s.eventPublisher.PublishPostDeleted(ctx, id)
		}, nil)
	}
	return nil
}

// SetPostSummary persists a generated summary and drops the affected
// cache entries so readers see the new value immediately.
func (s *PostService) SetPostSummary(ctx context.Context, id, summary string, status domain.PostStatus) error {
	if err := s.postRepo.UpdateSummary(ctx, id, summary, status); err != nil {
		return err
	}
	s.invalidatePost(ctx, id)
	return nil
}

// publishEvent is a nil-safe best-effort publish; a failed event never
// fails the underlying operation.
func (s *PostService) publishEvent(ctx context.Context, name, postID string, publish func(context.Context, *domain.Post) error, post *domain.Post) {
	if s.eventPublisher == nil {
		return
	}
	if err := publish(ctx, post); err != nil {
		middleware.LoggerFromContext(ctx).Error("failed to publish event", "event", name, "error", err, "postID", postID)
	}
}

func (s *PostService) GetPosts(ctx context.Context, page, limit int) (*domain.PaginatedPosts, error) {
	page, limit = pagination.Normalize(page, limit)
	return withCache(s.cache, ctx, cache.KeyPosts(page, limit), cache.PostsTTL, func() (*domain.PaginatedPosts, error) {
		return s.postRepo.FindAll(ctx, page, limit)
	})
}

func (s *PostService) GetPost(ctx context.Context, id string) (*domain.Post, error) {
	return withCache(s.cache, ctx, cache.KeyPost(id), cache.PostTTL, func() (*domain.Post, error) {
		return s.postRepo.FindByID(ctx, id)
	})
}

// GetPostsByIDs loads many posts in one repository call. It is the
// batch counterpart to GetPost, used by federation _entities resolution.
func (s *PostService) GetPostsByIDs(ctx context.Context, ids []string) ([]*domain.Post, error) {
	return s.postRepo.FindByIDs(ctx, ids)
}

func (s *PostService) GetPostsByAuthor(ctx context.Context, authorID string, page, limit int) (*domain.PaginatedPosts, error) {
	page, limit = pagination.Normalize(page, limit)
	return withCache(s.cache, ctx, cache.KeyPostsByAuthor(authorID, page, limit), cache.PostsTTL, func() (*domain.PaginatedPosts, error) {
		return s.postRepo.FindByAuthor(ctx, authorID, page, limit)
	})
}

func (s *PostService) GetPostsByTag(ctx context.Context, tag string, page, limit int) (*domain.PaginatedPosts, error) {
	page, limit = pagination.Normalize(page, limit)
	return withCache(s.cache, ctx, cache.KeyPostsByTag(tag, page, limit), cache.PostsTTL, func() (*domain.PaginatedPosts, error) {
		return s.postRepo.FindByTag(ctx, tag, page, limit)
	})
}

// invalidatePost drops the single-post entry and every list derived from it.
func (s *PostService) invalidatePost(ctx context.Context, id string) {
	cache.Del(s.cache, ctx, cache.KeyPost(id))
	invalidate(s.cache, ctx, cache.PostsPattern, cache.TagsPattern, cache.SearchPattern, cache.RelatedPattern)
}

// SearchPosts runs a hybrid search through the AI service and hydrates
// the matching posts from the repository, keeping the relevance order.
// Results are cached briefly; writes invalidate the whole search cache.
func (s *PostService) SearchPosts(ctx context.Context, query string, page, limit int) (*domain.SearchPostsResult, error) {
	page, limit = pagination.Normalize(page, limit)
	return withCache(s.cache, ctx, cache.KeySearch(query, page, limit), cache.SearchTTL, func() (*domain.SearchPostsResult, error) {
		search, err := s.aiService.SearchPosts(ctx, query, (page-1)*limit, limit)
		if err != nil {
			return nil, err
		}

		result := &domain.SearchPostsResult{Total: search.Total}
		if len(search.PostIDs) == 0 {
			result.Hits = []*domain.Post{}
			return result, nil
		}

		posts, err := s.postRepo.FindByIDs(ctx, search.PostIDs)
		if err != nil {
			return nil, err
		}

		byID := make(map[string]*domain.Post, len(posts))
		for _, post := range posts {
			byID[post.ID] = post
		}
		for _, id := range search.PostIDs {
			if post, ok := byID[id]; ok {
				result.Hits = append(result.Hits, post)
			}
		}
		return result, nil
	})
}

// RelatedPosts returns the semantic neighbours of a post, ranked by the
// AI service and hydrated from the repository in that order. Like search,
// results are cached briefly and writes invalidate the whole cache. The
// AI client degrades to an empty result when the AI service is down, so
// this never fails a post page for a non-critical section.
func (s *PostService) RelatedPosts(ctx context.Context, postID string, limit int) ([]*domain.Post, error) {
	limit = normalizeRelatedLimit(limit)
	return withCache(s.cache, ctx, cache.KeyRelated(postID, limit), cache.RelatedTTL, func() ([]*domain.Post, error) {
		search, err := s.aiService.RelatedPosts(ctx, postID, limit)
		if err != nil {
			return nil, err
		}

		if len(search.PostIDs) == 0 {
			return []*domain.Post{}, nil
		}

		posts, err := s.postRepo.FindByIDs(ctx, search.PostIDs)
		if err != nil {
			return nil, err
		}

		byID := make(map[string]*domain.Post, len(posts))
		for _, post := range posts {
			byID[post.ID] = post
		}
		related := make([]*domain.Post, 0, len(search.PostIDs))
		for _, id := range search.PostIDs {
			if post, ok := byID[id]; ok {
				related = append(related, post)
			}
		}
		return related, nil
	})
}

// RelatedPostsBatch resolves related posts for several post ids with a
// single AI RPC and a single hydration pass, keyed by the requested
// post id. Each id is served from the cache when present; only the
// misses hit the AI service, and their results are cached back. The AI
// client degrades to empty results when the AI service is down, so list
// pages never fail for a non-critical section.
func (s *PostService) RelatedPostsBatch(ctx context.Context, postIDs []string, limit int) (map[string][]*domain.Post, error) {
	limit = normalizeRelatedLimit(limit)
	results := make(map[string][]*domain.Post, len(postIDs))

	seen := make(map[string]bool, len(postIDs))
	var missing []string
	for _, postID := range postIDs {
		if postID == "" || seen[postID] {
			continue
		}
		seen[postID] = true

		key := cache.KeyRelated(postID, limit)
		if cached, ok := cache.Get[[]*domain.Post](s.cache, ctx, key); ok {
			metrics.CacheHits.Inc()
			results[postID] = *cached
			continue
		}
		metrics.CacheMisses.Inc()
		missing = append(missing, postID)
	}

	if len(missing) == 0 {
		return results, nil
	}

	search, err := s.aiService.RelatedPostsBatch(ctx, missing, limit)
	if err != nil {
		return nil, err
	}

	hydrated, err := s.postRepo.FindByIDs(ctx, uniqueIDs(search))
	if err != nil {
		return nil, err
	}

	byID := make(map[string]*domain.Post, len(hydrated))
	for _, post := range hydrated {
		byID[post.ID] = post
	}

	for _, postID := range missing {
		result := search[postID]
		related := make([]*domain.Post, 0, len(result.PostIDs))
		for _, id := range result.PostIDs {
			if post, ok := byID[id]; ok {
				related = append(related, post)
			}
		}
		cache.Set(s.cache, ctx, cache.KeyRelated(postID, limit), related, cache.RelatedTTL)
		results[postID] = related
	}
	return results, nil
}

// uniqueIDs collects the distinct post ids referenced by the search
// results, so hydration needs a single bounded FindByIDs call.
func uniqueIDs(search map[string]*domain.SearchResult) []string {
	seen := make(map[string]bool)
	var ids []string
	for _, result := range search {
		for _, id := range result.PostIDs {
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	return ids
}

func normalizeRelatedLimit(limit int) int {
	if limit < 1 {
		return 5
	}
	if limit > 20 {
		return 20
	}
	return limit
}

func (s *PostService) GenerateTags(ctx context.Context, title, body string) ([]string, error) {
	return s.aiService.GenerateTags(ctx, title, body)
}

func (s *PostService) GeneratePostContent(ctx context.Context, prompt string) (*domain.GeneratedPost, error) {
	return s.aiService.GeneratePost(ctx, prompt)
}

func isDuplicateKey(err error) bool {
	return mongo.IsDuplicateKeyError(err)
}

// normalizeTitle trims and bounds-checks a post title.
func normalizeTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", fmt.Errorf("%w: title is required", domain.ErrValidation)
	}
	if len(title) > maxTitleLen {
		return "", fmt.Errorf("%w: title is too long (max %d bytes)", domain.ErrValidation, maxTitleLen)
	}
	return title, nil
}

// normalizeBody trims and bounds-checks a post body.
func normalizeBody(body string) (string, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return "", fmt.Errorf("%w: body is required", domain.ErrValidation)
	}
	if len(body) > maxBodyLen {
		return "", fmt.Errorf("%w: body is too long (max %d bytes)", domain.ErrValidation, maxBodyLen)
	}
	return body, nil
}

// normalizeTags trims the tag list, drops empty entries, and enforces
// the count and per-tag length caps.
func normalizeTags(tags []string) ([]string, error) {
	if len(tags) > maxTagCount {
		return nil, fmt.Errorf("%w: too many tags (max %d)", domain.ErrValidation, maxTagCount)
	}
	cleaned := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if len(tag) > maxTagLen {
			return nil, fmt.Errorf("%w: tag is too long (max %d bytes)", domain.ErrValidation, maxTagLen)
		}
		cleaned = append(cleaned, tag)
	}
	return cleaned, nil
}

// ensureTags upserts the tag names of a post into the tag collection. A
// failure is logged, not fatal: the post's own tags array is the source
// of truth for per-post tagging, and the tag collection is only a
// listing index derived from it.
func (s *PostService) ensureTags(ctx context.Context, postID string, tags []string) {
	for _, tagName := range tags {
		if _, err := s.tagRepo.CreateOrFind(ctx, tagName); err != nil {
			middleware.LoggerFromContext(ctx).Warn("failed to create tag", "tag", tagName, "postID", postID, "error", err)
		}
	}
}
