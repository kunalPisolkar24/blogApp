package service

import (
	"context"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

type TagService struct {
	repo  domain.TagRepository
	cache *cache.Cache
}

func NewTagService(repo domain.TagRepository, cacheClient *cache.Cache) *TagService {
	return &TagService{repo: repo, cache: cacheClient}
}

func (s *TagService) GetTags(ctx context.Context, query *string, limit int) ([]*domain.Tag, error) {
	q := ""
	if query != nil {
		q = *query
	}

	if q == "" && limit == 0 {
		return withCache(s.cache, ctx, cache.KeyTags(q, 0), cache.TagsTTL, func() ([]*domain.Tag, error) {
			return s.repo.FindAll(ctx)
		})
	}
	if limit <= 0 {
		limit = 10
	}
	return withCache(s.cache, ctx, cache.KeyTags(q, limit), cache.TagsTTL, func() ([]*domain.Tag, error) {
		return s.repo.Search(ctx, q, limit)
	})
}
