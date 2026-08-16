package main

import (
	"context"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/graph"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
)

func newResolverWithMocks(t *testing.T) *graph.Resolver {
	t.Helper()

	postRepo := &testutil.MockPostRepository{FindAllFn: func(ctx context.Context, page, limit int) (*domain.PaginatedPosts, error) {
		return &domain.PaginatedPosts{Posts: []*domain.Post{{ID: "p_1", Title: "Hello"}}, Page: 1}, nil
	}}

	return graph.NewResolver(
		service.NewPostService(postRepo, &testutil.MockTagRepository{}, nil, nil, nil),
		service.NewTagService(&testutil.MockTagRepository{}, nil),
		service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{}),
		service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}),
	)
}
