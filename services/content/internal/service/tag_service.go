package service

import (
	"context"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

type TagService struct {
	repo domain.TagRepository
}

func NewTagService(repo domain.TagRepository) *TagService {
	return &TagService{repo: repo}
}

func (s *TagService) GetTags(ctx context.Context, query *string, limit int) ([]*domain.Tag, error) {
	q := ""
	if query != nil {
		q = *query
	}
	if q == "" && limit == 0 {
		return s.repo.FindAll(ctx)
	}
	if limit <= 0 {
		limit = 10
	}
	return s.repo.Search(ctx, q, limit)
}
