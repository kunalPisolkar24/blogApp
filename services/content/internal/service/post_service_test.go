package service

import (
	"context"
	"errors"
	"strings"
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

func TestCreatePostRegeneratesSlugPerAttempt(t *testing.T) {
	seen := map[string]bool{}
	repo := &testutil.MockPostRepository{CreateFn: func(ctx context.Context, post *domain.Post) (*domain.Post, error) {
		if seen[post.Slug] {
			return nil, errors.New("slug repeated across retries")
		}
		seen[post.Slug] = true
		return nil, mongo.CommandError{Code: 11000}
	}}
	s := newService(t, repo, nil, nil)

	_, err := s.CreatePost(context.Background(), "Title", "Body", "u_1", nil, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "slug retries")
	assert.Len(t, seen, maxSlugRetries, "every retry must try a different slug")
}

func TestCreatePostSlugCollisionFailsFast(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindBySlugFn: func(ctx context.Context, slug string) (*domain.Post, error) {
			return &domain.Post{ID: "existing", Slug: slug}, nil
		},
	}
	s := newService(t, repo, nil, nil)

	_, err := s.CreatePost(context.Background(), "Title", "Body", "u_1", nil, nil, nil)
	require.ErrorIs(t, err, domain.ErrValidation)
	assert.Contains(t, err.Error(), "already taken")
	assert.Zero(t, repo.CreateCalls, "a known collision must not attempt an insert")
}

func TestCreatePostSlugCheckDBErrorPropagates(t *testing.T) {
	repo := &testutil.MockPostRepository{FindBySlugFn: func(ctx context.Context, slug string) (*domain.Post, error) {
		return nil, errors.New("db down")
	}}
	s := newService(t, repo, nil, nil)

	_, err := s.CreatePost(context.Background(), "Title", "Body", "u_1", nil, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "db down")
	assert.Zero(t, repo.CreateCalls)
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

func TestCreatePostValidation(t *testing.T) {
	longTitle := strings.Repeat("a", maxTitleLen+1)
	longBody := strings.Repeat("b", maxBodyLen+1)
	longTag := strings.Repeat("t", maxTagLen+1)
	tooManyTags := make([]string, maxTagCount+1)

	tests := []struct {
		name    string
		title   string
		body    string
		tags    []string
		wantErr string
	}{
		{name: "empty title", wantErr: "title is required"},
		{name: "whitespace title", title: "   ", body: "Body", wantErr: "title is required"},
		{name: "empty body", title: "Title", wantErr: "body is required"},
		{name: "title too long", title: longTitle, body: "Body", wantErr: "title is too long"},
		{name: "body too long", title: "Title", body: longBody, wantErr: "body is too long"},
		{name: "too many tags", title: "Title", body: "Body", tags: tooManyTags, wantErr: "too many tags"},
		{name: "tag too long", title: "Title", body: "Body", tags: []string{longTag}, wantErr: "tag is too long"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &testutil.MockPostRepository{}
			s := newService(t, repo, nil, nil)

			_, err := s.CreatePost(context.Background(), tt.title, tt.body, "u_1", tt.tags, nil, nil)

			require.ErrorIs(t, err, domain.ErrValidation)
			assert.Contains(t, err.Error(), tt.wantErr)
			assert.Zero(t, repo.CreateCalls, "invalid input must not reach the repository")
		})
	}
}

func TestCreatePostTrimsInput(t *testing.T) {
	s := newService(t, nil, nil, nil)

	post, err := s.CreatePost(context.Background(), "  Title  ", "  Body  ", "u_1", []string{"  go ", "", "rust "}, nil, nil)

	require.NoError(t, err)
	assert.Equal(t, "Title", post.Title)
	assert.Equal(t, "Body", post.Body)
	assert.Equal(t, []string{"go", "rust"}, post.Tags)
}

func TestCreatePostTagErrorIsTolerated(t *testing.T) {
	s := NewPostService(
		&testutil.MockPostRepository{},
		&testutil.MockTagRepository{CreateOrFindFn: func(ctx context.Context, name string) (*domain.Tag, error) {
			return nil, errors.New("tag db down")
		}},
		&testutil.MockAIService{},
		nil,
		nil,
	)

	post, err := s.CreatePost(context.Background(), "Title", "Body", "u_1", []string{"go"}, nil, nil)

	require.NoError(t, err)
	require.NotNil(t, post)
}

func TestUpdatePostValidation(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return &domain.Post{ID: "p_1", AuthorID: "u_1", Title: "Old"}, nil
		},
	}
	s := newService(t, repo, nil, nil)

	empty := ""
	_, err := s.UpdatePost(context.Background(), "p_1", "u_1", &empty, nil, nil, nil)
	require.ErrorIs(t, err, domain.ErrValidation)
	assert.Contains(t, err.Error(), "title is required")

	_, err = s.UpdatePost(context.Background(), "p_1", "u_1", nil, &empty, nil, nil)
	require.ErrorIs(t, err, domain.ErrValidation)
	assert.Contains(t, err.Error(), "body is required")

	long := strings.Repeat("a", maxTitleLen+1)
	_, err = s.UpdatePost(context.Background(), "p_1", "u_1", &long, nil, nil, nil)
	require.ErrorIs(t, err, domain.ErrValidation)
}

func TestUpdatePostUnchangedValuesDoNotResetSummary(t *testing.T) {
	existing := &domain.Post{ID: "p_1", AuthorID: "u_1", Title: "Same", Body: "SameBody"}
	var got *domain.Post
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) { return existing, nil },
		UpdateFn: func(ctx context.Context, id string, post *domain.Post) (*domain.Post, error) {
			got = post
			return post, nil
		},
	}
	s := newService(t, repo, nil, nil)

	title, body := "Same", "SameBody"
	_, err := s.UpdatePost(context.Background(), "p_1", "u_1", &title, &body, nil, nil)

	require.NoError(t, err)
	assert.False(t, got.ResetSummary, "unchanged title/body must not reset the summary")
	assert.Empty(t, got.Title, "unchanged title must not be rewritten")
	assert.Empty(t, got.Body, "unchanged body must not be rewritten")
	assert.Empty(t, got.Slug, "unchanged title must not regenerate the slug")
}

func TestUpdatePostImageOnlyDoesNotResetSummary(t *testing.T) {
	existing := &domain.Post{ID: "p_1", AuthorID: "u_1", Title: "Title", Body: "Body"}
	var got *domain.Post
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) { return existing, nil },
		UpdateFn: func(ctx context.Context, id string, post *domain.Post) (*domain.Post, error) {
			got = post
			return post, nil
		},
	}
	s := newService(t, repo, nil, nil)

	imageURL := "https://example.com/image.png"
	_, err := s.UpdatePost(context.Background(), "p_1", "u_1", nil, nil, nil, &imageURL)

	require.NoError(t, err)
	assert.False(t, got.ResetSummary, "an imageUrl-only edit must not reset the summary")
	assert.Empty(t, got.Title)
	assert.Empty(t, got.Body)
	assert.Empty(t, got.Slug)
}

func TestUpdatePostChangedValuesResetSummary(t *testing.T) {
	existing := &domain.Post{ID: "p_1", AuthorID: "u_1", Title: "Old", Body: "OldBody"}
	var got *domain.Post
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) { return existing, nil },
		UpdateFn: func(ctx context.Context, id string, post *domain.Post) (*domain.Post, error) {
			got = post
			return post, nil
		},
	}
	s := newService(t, repo, nil, nil)

	title := "New"
	_, err := s.UpdatePost(context.Background(), "p_1", "u_1", &title, nil, nil, nil)

	require.NoError(t, err)
	assert.True(t, got.ResetSummary, "a real title change must reset the summary")
	assert.Equal(t, "New", got.Title)
	assert.NotEmpty(t, got.Slug)
}

func TestUpdatePostTagErrorIsTolerated(t *testing.T) {
	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return &domain.Post{ID: "p_1", AuthorID: "u_1", Title: "Old"}, nil
		},
		UpdateFn: func(ctx context.Context, id string, post *domain.Post) (*domain.Post, error) {
			return post, nil
		},
	}
	s := NewPostService(
		repo,
		&testutil.MockTagRepository{CreateOrFindFn: func(ctx context.Context, name string) (*domain.Tag, error) {
			return nil, errors.New("tag db down")
		}},
		&testutil.MockAIService{},
		nil,
		nil,
	)

	title := "New"
	_, err := s.UpdatePost(context.Background(), "p_1", "u_1", &title, nil, []string{"go"}, nil)

	require.NoError(t, err)
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

func TestRelatedPostsRanksAndDropsMissing(t *testing.T) {
	ai := &testutil.MockAIService{RelatedPostsFn: func(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
		assert.Equal(t, "p_1", postID)
		assert.Equal(t, 5, limit)
		return &domain.SearchResult{PostIDs: []string{"p_3", "missing", "p_2"}, Total: 3}, nil
	}}
	repo := &testutil.MockPostRepository{FindByIDsFn: func(ctx context.Context, ids []string) ([]*domain.Post, error) {
		assert.Equal(t, []string{"p_3", "missing", "p_2"}, ids)
		return []*domain.Post{
			{ID: "p_2", Title: "Second"},
			{ID: "p_3", Title: "Third"},
		}, nil
	}}
	s := newSearchService(t, ai, repo, nil)

	posts, err := s.RelatedPosts(context.Background(), "p_1", 5)

	require.NoError(t, err)
	require.Len(t, posts, 2)
	assert.Equal(t, "p_3", posts[0].ID, "related posts keep the AI rank order")
	assert.Equal(t, "p_2", posts[1].ID)
}

func TestRelatedPostsEmptyResult(t *testing.T) {
	ai := &testutil.MockAIService{RelatedPostsFn: func(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
		return &domain.SearchResult{PostIDs: nil, Total: 0}, nil
	}}
	s := newSearchService(t, ai, nil, nil)

	posts, err := s.RelatedPosts(context.Background(), "p_1", 5)

	require.NoError(t, err)
	assert.Empty(t, posts)
}

func TestRelatedPostsNormalizesLimit(t *testing.T) {
	ai := &testutil.MockAIService{RelatedPostsFn: func(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
		assert.Equal(t, 5, limit, "zero limit defaults to 5")
		return &domain.SearchResult{}, nil
	}}
	s := newSearchService(t, ai, nil, nil)

	_, err := s.RelatedPosts(context.Background(), "p_1", 0)
	require.NoError(t, err)

	ai.RelatedPostsFn = func(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
		assert.Equal(t, 20, limit, "limit is capped at 20")
		return &domain.SearchResult{}, nil
	}
	_, err = s.RelatedPosts(context.Background(), "p_1", 100)
	require.NoError(t, err)
}

func TestRelatedPostsAIError(t *testing.T) {
	wantErr := errors.New("ai down")
	ai := &testutil.MockAIService{RelatedPostsFn: func(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
		return nil, wantErr
	}}
	s := newSearchService(t, ai, nil, nil)

	_, err := s.RelatedPosts(context.Background(), "p_1", 5)
	assert.ErrorIs(t, err, wantErr)
}

func TestRelatedPostsRepoError(t *testing.T) {
	wantErr := errors.New("db down")
	ai := &testutil.MockAIService{RelatedPostsFn: func(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
		return &domain.SearchResult{PostIDs: []string{"p_2"}, Total: 1}, nil
	}}
	repo := &testutil.MockPostRepository{FindByIDsFn: func(ctx context.Context, ids []string) ([]*domain.Post, error) {
		return nil, wantErr
	}}
	s := newSearchService(t, ai, repo, nil)

	_, err := s.RelatedPosts(context.Background(), "p_1", 5)
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
