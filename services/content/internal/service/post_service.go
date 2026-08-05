package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/slug"
	"go.mongodb.org/mongo-driver/mongo"
)

const maxSlugRetries = 5

type PostService struct {
	postRepo  domain.PostRepository
	tagRepo   domain.TagRepository
	aiService domain.AIService
	clock     func() time.Time
}

func NewPostService(postRepo domain.PostRepository, tagRepo domain.TagRepository, aiService domain.AIService) *PostService {
	return &PostService{
		postRepo:  postRepo,
		tagRepo:   tagRepo,
		aiService: aiService,
		clock:     time.Now,
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

	return s.postRepo.Update(ctx, id, post)
}

func (s *PostService) DeletePost(ctx context.Context, id, actorID string) error {
	existing, err := s.postRepo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if existing.AuthorID != actorID {
		return domain.ErrForbidden
	}
	return s.postRepo.Delete(ctx, id)
}

func (s *PostService) GetPosts(ctx context.Context, page, limit int) (*domain.PaginatedPosts, error) {
	return s.postRepo.FindAll(ctx, page, limit)
}

func (s *PostService) GetPost(ctx context.Context, id string) (*domain.Post, error) {
	return s.postRepo.FindByID(ctx, id)
}

func (s *PostService) GetPostsByAuthor(ctx context.Context, authorID string, page, limit int) (*domain.PaginatedPosts, error) {
	return s.postRepo.FindByAuthor(ctx, authorID, page, limit)
}

func (s *PostService) GetPostsByTag(ctx context.Context, tag string, page, limit int) (*domain.PaginatedPosts, error) {
	return s.postRepo.FindByTag(ctx, tag, page, limit)
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
