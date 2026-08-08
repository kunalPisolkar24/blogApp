package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
	"github.com/kunalPisolkar24/topos/services/content/internal/middleware"
	"github.com/kunalPisolkar24/topos/services/content/internal/slug"
	"go.mongodb.org/mongo-driver/mongo"
)

const maxSlugRetries = 5

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
	for _, tagName := range tags {
		_, _ = s.tagRepo.CreateOrFind(ctx, tagName)
	}

	summaryValue := ""
	summaryStatus := domain.PostStatusPending
	if summary != nil {
		if trimmed := strings.TrimSpace(*summary); trimmed != "" {
			summaryValue = trimmed
			summaryStatus = domain.PostStatusCompleted
		}
	}

	now := s.clock()
	var created *domain.Post
	for attempt := 0; attempt < maxSlugRetries; attempt++ {
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

		var err error
		created, err = s.postRepo.Create(ctx, post)
		if err == nil {
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
	}
	return nil, fmt.Errorf("failed to create post after %d slug retries", maxSlugRetries)
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
	summaryNeedsReset := false

	if title != nil {
		post.Title = *title
		post.Slug = slug.Generate(*title, post.UpdatedAt)
		summaryNeedsReset = true
	}
	if body != nil {
		post.Body = *body
		summaryNeedsReset = true
	}
	if imageUrl != nil {
		post.ImageUrl = imageUrl
	}
	if tags != nil {
		post.Tags = tags
		for _, tagName := range tags {
			_, _ = s.tagRepo.CreateOrFind(ctx, tagName)
		}
	}

	if summaryNeedsReset {
		post.Summary = ""
		post.SummaryStatus = domain.PostStatusPending
		post.ResetSummary = true
	}

	updated, err := s.postRepo.Update(ctx, id, post)
	if err == nil {
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
	page, limit = normalizePagination(page, limit)
	return withCache(s.cache, ctx, cache.KeyPosts(page, limit), cache.PostsTTL, func() (*domain.PaginatedPosts, error) {
		return s.postRepo.FindAll(ctx, page, limit)
	})
}

func (s *PostService) GetPost(ctx context.Context, id string) (*domain.Post, error) {
	return withCache(s.cache, ctx, cache.KeyPost(id), cache.PostTTL, func() (*domain.Post, error) {
		return s.postRepo.FindByID(ctx, id)
	})
}

func (s *PostService) GetPostsByAuthor(ctx context.Context, authorID string, page, limit int) (*domain.PaginatedPosts, error) {
	page, limit = normalizePagination(page, limit)
	return withCache(s.cache, ctx, cache.KeyPostsByAuthor(authorID, page, limit), cache.PostsTTL, func() (*domain.PaginatedPosts, error) {
		return s.postRepo.FindByAuthor(ctx, authorID, page, limit)
	})
}

func (s *PostService) GetPostsByTag(ctx context.Context, tag string, page, limit int) (*domain.PaginatedPosts, error) {
	page, limit = normalizePagination(page, limit)
	return withCache(s.cache, ctx, cache.KeyPostsByTag(tag, page, limit), cache.PostsTTL, func() (*domain.PaginatedPosts, error) {
		return s.postRepo.FindByTag(ctx, tag, page, limit)
	})
}

// invalidatePost drops the single-post entry and every list derived from it.
func (s *PostService) invalidatePost(ctx context.Context, id string) {
	cache.Del(s.cache, ctx, cache.KeyPost(id))
	invalidate(s.cache, ctx, cache.PostsPattern, cache.TagsPattern, cache.SearchPattern, cache.RelatedPattern)
}

// normalizePagination mirrors the repository's defaulting so cache keys
// stay canonical regardless of how callers spell the arguments.
func normalizePagination(page, limit int) (int, int) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	return page, limit
}

// SearchPosts runs a hybrid search through the AI service and hydrates
// the matching posts from the repository, keeping the relevance order.
// Results are cached briefly; writes invalidate the whole search cache.
func (s *PostService) SearchPosts(ctx context.Context, query string, page, limit int) (*domain.SearchPostsResult, error) {
	page, limit = normalizePagination(page, limit)
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
