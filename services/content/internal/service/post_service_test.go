package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/mongo"
)

func newService(t *testing.T, postRepo *testutil.MockPostRepository, publisher *testutil.MockEventPublisher, cacheClient *cache.Cache) *PostService {
	t.Helper()

	if postRepo == nil {
		postRepo = &testutil.MockPostRepository{}
	}
	if publisher == nil {
		publisher = &testutil.MockEventPublisher{}
	}
	return NewPostService(
		postRepo,
		&testutil.MockTagRepository{},
		&testutil.MockAIService{},
		publisher,
		cacheClient,
	)
}

func newMemCache(t *testing.T) *cache.Cache {
	t.Helper()

	mr := miniredis.RunT(t)
	c, err := cache.New(context.Background(), cache.Options{Addr: mr.Addr()})
	require.NoError(t, err)
	t.Cleanup(func() { c.Close() })
	return c
}

func TestCreatePost(t *testing.T) {
	publisher := &testutil.MockEventPublisher{}
	s := newService(t, nil, publisher, nil)

	post, err := s.CreatePost(context.Background(), "Title", "Body", "u_1", nil, nil, nil)

	require.NoError(t, err)
	assert.Equal(t, "Title", post.Title)
	assert.Equal(t, domain.PostStatusPending, post.SummaryStatus)
	assert.Contains(t, post.Slug, "title-")
	assert.Len(t, publisher.Created, 1)
}

func TestCreatePostWithSummary(t *testing.T) {
	summary := "provided summary"
	s := newService(t, nil, nil, nil)

	post, err := s.CreatePost(context.Background(), "Title", "Body", "u_1", nil, nil, &summary)

	require.NoError(t, err)
	assert.Equal(t, domain.PostStatusCompleted, post.SummaryStatus)
	assert.Equal(t, summary, post.Summary)
}

func TestCreatePostRepoError(t *testing.T) {
	wantErr := errors.New("db down")
	repo := &testutil.MockPostRepository{CreateFn: func(ctx context.Context, post *domain.Post) (*domain.Post, error) {
		return nil, wantErr
	}}
	s := newService(t, repo, nil, nil)

	_, err := s.CreatePost(context.Background(), "Title", "Body", "u_1", nil, nil, nil)
	assert.ErrorIs(t, err, wantErr)
}

func TestCreatePostSlugRetriesExhausted(t *testing.T) {
	repo := &testutil.MockPostRepository{CreateFn: func(ctx context.Context, post *domain.Post) (*domain.Post, error) {
		return nil, mongo.CommandError{Code: 11000}
	}}
	s := newService(t, repo, nil, nil)

	_, err := s.CreatePost(context.Background(), "Title", "Body", "u_1", nil, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "slug retries")
	assert.Equal(t, maxSlugRetries, repo.CreateCalls)
}

func TestCreatePostPublishFailureIsIgnored(t *testing.T) {
	publisher := &testutil.MockEventPublisher{Err: errors.New("kafka down")}
	s := newService(t, nil, publisher, nil)

	post, err := s.CreatePost(context.Background(), "Title", "Body", "u_1", nil, nil, nil)
	require.NoError(t, err)
	require.NotNil(t, post)
}

func TestCreatePostNilPublisher(t *testing.T) {
	s := NewPostService(
		&testutil.MockPostRepository{},
		&testutil.MockTagRepository{},
		&testutil.MockAIService{},
		nil,
		nil,
	)

	_, err := s.CreatePost(context.Background(), "Title", "Body", "u_1", nil, nil, nil)
	require.NoError(t, err)
}

func TestUpdatePost(t *testing.T) {
	existing := &domain.Post{ID: "p_1", AuthorID: "u_1"}
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) { return existing, nil },
		UpdateFn: func(ctx context.Context, id string, post *domain.Post) (*domain.Post, error) {
			return post, nil
		},
	}
	publisher := &testutil.MockEventPublisher{}
	s := newService(t, repo, publisher, nil)

	title := "New Title"
	post, err := s.UpdatePost(context.Background(), "p_1", "u_1", &title, nil, nil, nil)

	require.NoError(t, err)
	assert.Equal(t, "New Title", post.Title)
	assert.Len(t, publisher.Updated, 1)
}

func TestUpdatePostForbidden(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return &domain.Post{ID: "p_1", AuthorID: "u_other"}, nil
		},
	}
	s := newService(t, repo, nil, nil)

	_, err := s.UpdatePost(context.Background(), "p_1", "u_1", nil, nil, nil, nil)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestUpdatePostNotFound(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return nil, domain.ErrNotFound
		},
	}
	s := newService(t, repo, nil, nil)

	_, err := s.UpdatePost(context.Background(), "p_1", "u_1", nil, nil, nil, nil)
	assert.ErrorIs(t, err, domain.ErrNotFound)
}

func TestUpdatePostResetsSummaryOnTitleChange(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return &domain.Post{ID: "p_1", AuthorID: "u_1"}, nil
		},
		UpdateFn: func(ctx context.Context, id string, post *domain.Post) (*domain.Post, error) {
			return post, nil
		},
	}
	s := newService(t, repo, nil, nil)

	title := "Renamed"
	post, err := s.UpdatePost(context.Background(), "p_1", "u_1", &title, nil, nil, nil)

	require.NoError(t, err)
	assert.True(t, post.ResetSummary)
}

func TestDeletePost(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return &domain.Post{ID: "p_1", AuthorID: "u_1"}, nil
		},
	}
	publisher := &testutil.MockEventPublisher{}
	s := newService(t, repo, publisher, nil)

	err := s.DeletePost(context.Background(), "p_1", "u_1")

	require.NoError(t, err)
	assert.Equal(t, []string{"p_1"}, publisher.Deleted)
}

func TestDeletePostForbidden(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return &domain.Post{ID: "p_1", AuthorID: "u_other"}, nil
		},
	}
	s := newService(t, repo, nil, nil)

	err := s.DeletePost(context.Background(), "p_1", "u_1")
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestSetPostSummary(t *testing.T) {
	repo := &testutil.MockPostRepository{
		UpdateSummaryFn: func(ctx context.Context, id, summary string, status domain.PostStatus) error {
			return errors.New("boom")
		},
	}
	s := newService(t, repo, nil, nil)

	err := s.SetPostSummary(context.Background(), "p_1", "summary", domain.PostStatusCompleted)
	assert.ErrorContains(t, err, "boom")
}

func TestGetPosts(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindAllFn: func(ctx context.Context, page, limit int) (*domain.PaginatedPosts, error) {
			return &domain.PaginatedPosts{Page: page, Posts: []*domain.Post{{ID: "p_1"}}}, nil
		},
	}
	s := newService(t, repo, nil, nil)

	result, err := s.GetPosts(context.Background(), 1, 10)
	require.NoError(t, err)
	assert.Len(t, result.Posts, 1)
}

func TestGetPostsCached(t *testing.T) {
	calls := 0
	repo := &testutil.MockPostRepository{
		FindAllFn: func(ctx context.Context, page, limit int) (*domain.PaginatedPosts, error) {
			calls++
			return &domain.PaginatedPosts{Page: page}, nil
		},
	}
	s := newService(t, repo, nil, newMemCache(t))

	_, err := s.GetPosts(context.Background(), 1, 10)
	require.NoError(t, err)
	_, err = s.GetPosts(context.Background(), 1, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, calls, "second read should hit the cache")
}

func TestGetPostsPaginationNormalized(t *testing.T) {
	var gotPage, gotLimit int
	repo := &testutil.MockPostRepository{
		FindAllFn: func(ctx context.Context, page, limit int) (*domain.PaginatedPosts, error) {
			gotPage, gotLimit = page, limit
			return &domain.PaginatedPosts{}, nil
		},
	}
	s := newService(t, repo, nil, nil)

	_, err := s.GetPosts(context.Background(), 0, 500)
	require.NoError(t, err)
	assert.Equal(t, 1, gotPage)
	assert.Equal(t, 100, gotLimit)
}

func TestGetPostRepoErrorNotCached(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return nil, domain.ErrNotFound
		},
	}
	s := newService(t, repo, nil, newMemCache(t))

	_, err := s.GetPost(context.Background(), "missing")
	assert.ErrorIs(t, err, domain.ErrNotFound)
}

func TestGetPostFromCache(t *testing.T) {
	calls := 0
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			calls++
			return &domain.Post{ID: id, Title: "t"}, nil
		},
	}
	s := newService(t, repo, nil, newMemCache(t))

	for i := 0; i < 2; i++ {
		post, err := s.GetPost(context.Background(), "p_1")
		require.NoError(t, err)
		assert.Equal(t, "t", post.Title)
	}
	assert.Equal(t, 1, calls)
}

func TestGetPostsByAuthor(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindByAuthorFn: func(ctx context.Context, authorID string, page, limit int) (*domain.PaginatedPosts, error) {
			return &domain.PaginatedPosts{Page: page}, nil
		},
	}
	s := newService(t, repo, nil, nil)

	result, err := s.GetPostsByAuthor(context.Background(), "u_1", 2, 10)
	require.NoError(t, err)
	assert.Equal(t, 2, result.Page)
}

func TestGetPostsByTag(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindByTagFn: func(ctx context.Context, tag string, page, limit int) (*domain.PaginatedPosts, error) {
			return &domain.PaginatedPosts{Page: page}, nil
		},
	}
	s := newService(t, repo, nil, nil)

	result, err := s.GetPostsByTag(context.Background(), "go", 3, 10)
	require.NoError(t, err)
	assert.Equal(t, 3, result.Page)
}

func TestGetPostsByTagCached(t *testing.T) {
	calls := 0
	repo := &testutil.MockPostRepository{
		FindByTagFn: func(ctx context.Context, tag string, page, limit int) (*domain.PaginatedPosts, error) {
			calls++
			return &domain.PaginatedPosts{}, nil
		},
	}
	s := newService(t, repo, nil, newMemCache(t))

	for i := 0; i < 2; i++ {
		_, err := s.GetPostsByTag(context.Background(), "go", 1, 10)
		require.NoError(t, err)
	}
	assert.Equal(t, 1, calls)
}

func TestGenerateTags(t *testing.T) {
	ai := &testutil.MockAIService{GenerateTagsFn: func(ctx context.Context, title, body string) ([]string, error) {
		return []string{"go"}, nil
	}}
	s := NewPostService(nil, nil, ai, nil, nil)

	tags, err := s.GenerateTags(context.Background(), "t", "b")
	require.NoError(t, err)
	assert.Equal(t, []string{"go"}, tags)
}

func TestGeneratePostContent(t *testing.T) {
	ai := &testutil.MockAIService{GeneratePostFn: func(ctx context.Context, prompt string) (*domain.GeneratedPost, error) {
		return &domain.GeneratedPost{Title: "t"}, nil
	}}
	s := NewPostService(nil, nil, ai, nil, nil)

	post, err := s.GeneratePostContent(context.Background(), "prompt")
	require.NoError(t, err)
	assert.Equal(t, "t", post.Title)
}

func TestNormalizePagination(t *testing.T) {
	page, limit := normalizePagination(0, 0)
	assert.Equal(t, 1, page)
	assert.Equal(t, 10, limit)

	page, limit = normalizePagination(3, 20)
	assert.Equal(t, 3, page)
	assert.Equal(t, 20, limit)

	page, limit = normalizePagination(-1, 500)
	assert.Equal(t, 1, page)
	assert.Equal(t, 100, limit)
}

func TestPostServiceClock(t *testing.T) {
	s := NewPostService(&testutil.MockPostRepository{}, nil, nil, nil, nil)
	now := time.Now()
	assert.NotZero(t, s.clock().Sub(now))
}

func newSearchService(t *testing.T, ai *testutil.MockAIService, repo *testutil.MockPostRepository, cacheClient *cache.Cache) *PostService {
	t.Helper()
	if ai == nil {
		ai = &testutil.MockAIService{}
	}
	if repo == nil {
		repo = &testutil.MockPostRepository{}
	}
	return NewPostService(repo, nil, ai, nil, cacheClient)
}

func TestSearchPostsRanksAndDropsMissing(t *testing.T) {
	ai := &testutil.MockAIService{SearchPostsFn: func(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
		assert.Equal(t, "go", query)
		assert.Equal(t, 0, offset)
		assert.Equal(t, 10, limit)
		return &domain.SearchResult{PostIDs: []string{"p_2", "missing", "p_1"}, Total: 3}, nil
	}}
	repo := &testutil.MockPostRepository{FindByIDsFn: func(ctx context.Context, ids []string) ([]*domain.Post, error) {
		assert.Equal(t, []string{"p_2", "missing", "p_1"}, ids)
		return []*domain.Post{
			{ID: "p_1", Title: "First"},
			{ID: "p_2", Title: "Second"},
		}, nil
	}}
	s := newSearchService(t, ai, repo, nil)

	result, err := s.SearchPosts(context.Background(), "go", 1, 10)

	require.NoError(t, err)
	assert.Equal(t, 3, result.Total)
	require.Len(t, result.Hits, 2)
	assert.Equal(t, "p_2", result.Hits[0].ID, "hits keep the search rank order")
	assert.Equal(t, "p_1", result.Hits[1].ID)
}

func TestSearchPostsEmptyResult(t *testing.T) {
	ai := &testutil.MockAIService{SearchPostsFn: func(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
		return &domain.SearchResult{PostIDs: nil, Total: 0}, nil
	}}
	s := newSearchService(t, ai, nil, nil)

	result, err := s.SearchPosts(context.Background(), "nothing", 1, 10)

	require.NoError(t, err)
	assert.Equal(t, 0, result.Total)
	assert.Empty(t, result.Hits)
}

func TestSearchPostsAIError(t *testing.T) {
	wantErr := errors.New("ai down")
	ai := &testutil.MockAIService{SearchPostsFn: func(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
		return nil, wantErr
	}}
	s := newSearchService(t, ai, nil, nil)

	_, err := s.SearchPosts(context.Background(), "go", 1, 10)
	assert.ErrorIs(t, err, wantErr)
}

func TestSearchPostsRepoError(t *testing.T) {
	wantErr := errors.New("db down")
	ai := &testutil.MockAIService{SearchPostsFn: func(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
		return &domain.SearchResult{PostIDs: []string{"p_1"}, Total: 1}, nil
	}}
	repo := &testutil.MockPostRepository{FindByIDsFn: func(ctx context.Context, ids []string) ([]*domain.Post, error) {
		return nil, wantErr
	}}
	s := newSearchService(t, ai, repo, nil)

	_, err := s.SearchPosts(context.Background(), "go", 1, 10)
	assert.ErrorIs(t, err, wantErr)
}

func TestSearchPostsPaginationNormalized(t *testing.T) {
	var gotOffset, gotLimit int
	ai := &testutil.MockAIService{SearchPostsFn: func(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
		gotOffset, gotLimit = offset, limit
		return &domain.SearchResult{}, nil
	}}
	s := newSearchService(t, ai, nil, nil)

	_, err := s.SearchPosts(context.Background(), "go", 3, 10)
	require.NoError(t, err)
	assert.Equal(t, 20, gotOffset)
	assert.Equal(t, 10, gotLimit)

	_, err = s.SearchPosts(context.Background(), "go", 0, 500)
	require.NoError(t, err)
	assert.Equal(t, 0, gotOffset)
	assert.Equal(t, 100, gotLimit)
}

func TestSearchPostsCached(t *testing.T) {
	calls := 0
	ai := &testutil.MockAIService{SearchPostsFn: func(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
		calls++
		return &domain.SearchResult{PostIDs: []string{"p_1"}, Total: 1}, nil
	}}
	s := newSearchService(t, ai, nil, newMemCache(t))

	for i := 0; i < 2; i++ {
		result, err := s.SearchPosts(context.Background(), "go", 1, 10)
		require.NoError(t, err)
		assert.Len(t, result.Hits, 1)
	}
	assert.Equal(t, 1, calls, "second search should hit the cache")
}

func TestCreatePostInvalidatesSearchCache(t *testing.T) {
	calls := 0
	ai := &testutil.MockAIService{SearchPostsFn: func(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
		calls++
		return &domain.SearchResult{}, nil
	}}
	s := newSearchService(t, ai, nil, newMemCache(t))

	_, err := s.SearchPosts(context.Background(), "go", 1, 10)
	require.NoError(t, err)

	_, err = s.CreatePost(context.Background(), "Title", "Body", "u_1", nil, nil, nil)
	require.NoError(t, err)

	_, err = s.SearchPosts(context.Background(), "go", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, 2, calls, "a write must invalidate the search cache")
}

func TestUpdatePostInvalidatesSearchCache(t *testing.T) {
	calls := 0
	ai := &testutil.MockAIService{SearchPostsFn: func(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
		calls++
		return &domain.SearchResult{}, nil
	}}
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return &domain.Post{ID: "p_1", AuthorID: "u_1"}, nil
		},
		UpdateFn: func(ctx context.Context, id string, post *domain.Post) (*domain.Post, error) {
			return post, nil
		},
	}
	s := newSearchService(t, ai, repo, newMemCache(t))

	_, err := s.SearchPosts(context.Background(), "go", 1, 10)
	require.NoError(t, err)

	title := "Renamed"
	_, err = s.UpdatePost(context.Background(), "p_1", "u_1", &title, nil, nil, nil)
	require.NoError(t, err)

	_, err = s.SearchPosts(context.Background(), "go", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, 2, calls, "a write must invalidate the search cache")
}
