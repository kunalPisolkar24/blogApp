package service

import (
	"context"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetTagsAll(t *testing.T) {
	repo := &testutil.MockTagRepository{
		FindAllFn: func(ctx context.Context) ([]*domain.Tag, error) {
			return []*domain.Tag{{ID: "go", Name: "go"}}, nil
		},
		SearchFn: func(ctx context.Context, query string, limit int) ([]*domain.Tag, error) {
			t.Fatal("Search must not be called without a query")
			return nil, nil
		},
	}
	s := NewTagService(repo, nil)

	tags, err := s.GetTags(context.Background(), nil, 0)
	require.NoError(t, err)
	assert.Len(t, tags, 1)
}

func TestGetTagsSearch(t *testing.T) {
	repo := &testutil.MockTagRepository{
		SearchFn: func(ctx context.Context, query string, limit int) ([]*domain.Tag, error) {
			assert.Equal(t, "go", query)
			assert.Equal(t, 10, limit, "limit <= 0 defaults to 10")
			return []*domain.Tag{{ID: "golang", Name: "golang"}}, nil
		},
	}
	s := NewTagService(repo, nil)

	query := "go"
	tags, err := s.GetTags(context.Background(), &query, 0)
	require.NoError(t, err)
	assert.Len(t, tags, 1)
}

func TestGetTagsSearchCached(t *testing.T) {
	calls := 0
	repo := &testutil.MockTagRepository{
		SearchFn: func(ctx context.Context, query string, limit int) ([]*domain.Tag, error) {
			calls++
			return []*domain.Tag{{Name: "go"}}, nil
		},
	}
	s := NewTagService(repo, newMemCache(t))

	query := "go"
	for i := 0; i < 2; i++ {
		_, err := s.GetTags(context.Background(), &query, 10)
		require.NoError(t, err)
	}
	assert.Equal(t, 1, calls)
}

func TestGetTagsAllCached(t *testing.T) {
	calls := 0
	repo := &testutil.MockTagRepository{
		FindAllFn: func(ctx context.Context) ([]*domain.Tag, error) {
			calls++
			return nil, nil
		},
	}
	s := NewTagService(repo, newMemCache(t))

	for i := 0; i < 2; i++ {
		_, err := s.GetTags(context.Background(), nil, 0)
		require.NoError(t, err)
	}
	assert.Equal(t, 1, calls)
}
