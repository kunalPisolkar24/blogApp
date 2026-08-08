package graph

import (
	"context"
	"errors"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/graph/model"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/middleware"
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

func newTestResolver(t *testing.T, postRepo *testutil.MockPostRepository, tagRepo *testutil.MockTagRepository) (*Resolver, *service.PostService, *service.TagService) {
	t.Helper()

	if postRepo == nil {
		postRepo = &testutil.MockPostRepository{}
	}
	if tagRepo == nil {
		tagRepo = &testutil.MockTagRepository{}
	}

	postSvc := service.NewPostService(postRepo, tagRepo, nil, nil, nil)
	tagSvc := service.NewTagService(tagRepo, nil)
	return NewResolver(postSvc, tagSvc), postSvc, tagSvc
}

func authenticatedContext(userID string) context.Context {
	return middleware.WithUserID(context.Background(), userID)
}

func TestQueryResolverPosts(t *testing.T) {
	repo := &testutil.MockPostRepository{FindAllFn: func(ctx context.Context, page, limit int) (*domain.PaginatedPosts, error) {
		assert.Equal(t, 2, page)
		assert.Equal(t, 10, limit)
		return &domain.PaginatedPosts{
			Posts: []*domain.Post{{ID: "p_1", Title: "Hello"}},
			Page:  2,
		}, nil
	}}
	resolver, _, _ := newTestResolver(t, repo, nil)

	posts, err := resolver.Query().Posts(context.Background(), intPtr(2), intPtr(10))
	require.NoError(t, err)
	require.Len(t, posts.Posts, 1)
	assert.Equal(t, "p_1", posts.Posts[0].ID)
	assert.Equal(t, "Hello", posts.Posts[0].Title)
}

func TestQueryResolverPostNotFound(t *testing.T) {
	repo := &testutil.MockPostRepository{FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return nil, domain.ErrNotFound
	}}
	resolver, _, _ := newTestResolver(t, repo, nil)

	_, err := resolver.Query().Post(context.Background(), "nope")
	require.Error(t, err)
	assert.Equal(t, "not found", err.(*gqlerror.Error).Message)
}

func TestQueryResolverPostsByTag(t *testing.T) {
	repo := &testutil.MockPostRepository{FindByTagFn: func(ctx context.Context, tag string, page, limit int) (*domain.PaginatedPosts, error) {
		assert.Equal(t, "go", tag)
		return &domain.PaginatedPosts{Posts: []*domain.Post{{ID: "p_1"}}, Page: 1}, nil
	}}
	resolver, _, _ := newTestResolver(t, repo, nil)

	posts, err := resolver.Query().PostsByTag(context.Background(), "go", nil, nil)
	require.NoError(t, err)
	require.Len(t, posts.Posts, 1)
	assert.Equal(t, "p_1", posts.Posts[0].ID)
}

func TestQueryResolverSearchPosts(t *testing.T) {
	ai := &testutil.MockAIService{SearchPostsFn: func(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
		assert.Equal(t, "go", query)
		assert.Equal(t, 0, offset)
		assert.Equal(t, 10, limit)
		return &domain.SearchResult{PostIDs: []string{"p_1"}, Total: 1}, nil
	}}
	postRepo := &testutil.MockPostRepository{FindByIDsFn: func(ctx context.Context, ids []string) ([]*domain.Post, error) {
		return []*domain.Post{{ID: "p_1", Title: "Hello"}}, nil
	}}
	postSvc := service.NewPostService(postRepo, &testutil.MockTagRepository{}, ai, nil, nil)
	resolver := NewResolver(postSvc, service.NewTagService(&testutil.MockTagRepository{}, nil))

	result, err := resolver.Query().SearchPosts(context.Background(), "go", intPtr(1), intPtr(10))

	require.NoError(t, err)
	assert.Equal(t, 1, result.Total)
	require.Len(t, result.Hits, 1)
	assert.Equal(t, "p_1", result.Hits[0].ID)
	assert.Equal(t, "Hello", result.Hits[0].Title)
}

func TestQueryResolverTags(t *testing.T) {
	tagRepo := &testutil.MockTagRepository{SearchFn: func(ctx context.Context, query string, limit int) ([]*domain.Tag, error) {
		assert.Equal(t, "go", query)
		return []*domain.Tag{{ID: "t_1", Name: "go"}}, nil
	}}
	resolver, _, _ := newTestResolver(t, nil, tagRepo)

	tags, err := resolver.Query().Tags(context.Background(), strPtr("go"), intPtr(5))
	require.NoError(t, err)
	require.Len(t, tags, 1)
	assert.Equal(t, "go", tags[0].Name)
}

func TestMutationResolverCreatePost(t *testing.T) {
	postRepo := &testutil.MockPostRepository{CreateFn: func(ctx context.Context, post *domain.Post) (*domain.Post, error) {
		post.ID = "p_new"
		return post, nil
	}}
	resolver, _, _ := newTestResolver(t, postRepo, nil)

	post, err := resolver.Mutation().CreatePost(authenticatedContext("u_1"), model.CreatePostInput{
		Title: "Hello",
		Body:  "World",
		Tags:  []string{"go"},
	})
	require.NoError(t, err)
	assert.Equal(t, "p_new", post.ID)
	assert.Equal(t, "Hello", post.Title)
}

func TestMutationResolverCreatePostUnauthorized(t *testing.T) {
	resolver, _, _ := newTestResolver(t, nil, nil)

	_, err := resolver.Mutation().CreatePost(context.Background(), model.CreatePostInput{Title: "x"})
	require.Error(t, err)
	assert.Equal(t, "unauthorized", err.(*gqlerror.Error).Message)
}

func TestMutationResolverUpdatePost(t *testing.T) {
	postRepo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return &domain.Post{ID: id, AuthorID: "u_1", Tags: []string{"old"}}, nil
		},
		UpdateFn: func(ctx context.Context, id string, post *domain.Post) (*domain.Post, error) {
			return post, nil
		},
	}
	resolver, _, _ := newTestResolver(t, postRepo, nil)

	post, err := resolver.Mutation().UpdatePost(authenticatedContext("u_1"), "p_1", model.UpdatePostInput{Title: strPtr("New")})
	require.NoError(t, err)
	assert.Equal(t, "New", post.Title)
}

func TestMutationResolverUpdatePostForbidden(t *testing.T) {
	postRepo := &testutil.MockPostRepository{FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, AuthorID: "someone-else"}, nil
	}}
	resolver, _, _ := newTestResolver(t, postRepo, nil)

	_, err := resolver.Mutation().UpdatePost(authenticatedContext("u_1"), "p_1", model.UpdatePostInput{})
	require.Error(t, err)
	assert.Equal(t, "forbidden", err.(*gqlerror.Error).Message)
}

func TestMutationResolverDeletePost(t *testing.T) {
	postRepo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			return &domain.Post{ID: id, AuthorID: "u_1"}, nil
		},
	}
	resolver, _, _ := newTestResolver(t, postRepo, nil)

	deleted, err := resolver.Mutation().DeletePost(authenticatedContext("u_1"), "p_1")
	require.NoError(t, err)
	assert.True(t, deleted)
}

func TestMutationResolverDeletePostForbidden(t *testing.T) {
	postRepo := &testutil.MockPostRepository{FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, AuthorID: "someone-else"}, nil
	}}
	resolver, _, _ := newTestResolver(t, postRepo, nil)

	_, err := resolver.Mutation().DeletePost(authenticatedContext("u_1"), "p_1")
	require.Error(t, err)
	assert.Equal(t, "forbidden", err.(*gqlerror.Error).Message)
}

func TestMutationResolverGenerateTags(t *testing.T) {
	postRepo := &testutil.MockPostRepository{}
	aiSvc := &testutil.MockAIService{GenerateTagsFn: func(ctx context.Context, title, body string) ([]string, error) {
		return []string{"go", "web"}, nil
	}}
	postSvc := service.NewPostService(postRepo, nil, aiSvc, nil, nil)
	resolver := NewResolver(postSvc, service.NewTagService(nil, nil))

	tags, err := resolver.Mutation().GenerateTags(authenticatedContext("u_1"), "Go", "web development")
	require.NoError(t, err)
	assert.Equal(t, []string{"go", "web"}, tags)
}

func TestMutationResolverGeneratePostContent(t *testing.T) {
	postRepo := &testutil.MockPostRepository{}
	aiSvc := &testutil.MockAIService{GeneratePostFn: func(ctx context.Context, prompt string) (*domain.GeneratedPost, error) {
		return &domain.GeneratedPost{Title: "T", Body: "B", Summary: "S", Tags: []string{"go"}}, nil
	}}
	postSvc := service.NewPostService(postRepo, nil, aiSvc, nil, nil)
	resolver := NewResolver(postSvc, service.NewTagService(nil, nil))

	post, err := resolver.Mutation().GeneratePostContent(authenticatedContext("u_1"), "prompt")
	require.NoError(t, err)
	assert.Equal(t, "T", post.Title)
	assert.Equal(t, []string{"go"}, post.Tags)
}

func TestUserResolverPosts(t *testing.T) {
	repo := &testutil.MockPostRepository{FindByAuthorFn: func(ctx context.Context, authorID string, page, limit int) (*domain.PaginatedPosts, error) {
		assert.Equal(t, "u_1", authorID)
		return &domain.PaginatedPosts{Posts: []*domain.Post{{ID: "p_1", AuthorID: "u_1"}}, Page: 1}, nil
	}}
	resolver, _, _ := newTestResolver(t, repo, nil)

	posts, err := resolver.User().Posts(context.Background(), &model.User{ID: "u_1"}, nil, nil)
	require.NoError(t, err)
	require.Len(t, posts.Posts, 1)
	assert.Equal(t, "p_1", posts.Posts[0].ID)
}

func TestPostResolverRelated(t *testing.T) {
	ai := &testutil.MockAIService{RelatedPostsFn: func(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
		assert.Equal(t, "p_1", postID)
		assert.Equal(t, 5, limit)
		return &domain.SearchResult{PostIDs: []string{"p_2"}, Total: 1}, nil
	}}
	postRepo := &testutil.MockPostRepository{FindByIDsFn: func(ctx context.Context, ids []string) ([]*domain.Post, error) {
		return []*domain.Post{{ID: "p_2", Title: "Similar"}}, nil
	}}
	postSvc := service.NewPostService(postRepo, &testutil.MockTagRepository{}, ai, nil, nil)
	resolver := NewResolver(postSvc, service.NewTagService(&testutil.MockTagRepository{}, nil))

	posts, err := resolver.Post().Related(context.Background(), &model.Post{ID: "p_1"}, intPtr(5))

	require.NoError(t, err)
	require.Len(t, posts, 1)
	assert.Equal(t, "p_2", posts[0].ID)
	assert.Equal(t, "Similar", posts[0].Title)
}

func TestPostResolverRelatedDefaultsLimit(t *testing.T) {
	ai := &testutil.MockAIService{RelatedPostsFn: func(ctx context.Context, postID string, limit int) (*domain.SearchResult, error) {
		assert.Equal(t, 5, limit, "nil limit is defaulted to 5 by the service layer")
		return &domain.SearchResult{}, nil
	}}
	postSvc := service.NewPostService(&testutil.MockPostRepository{}, &testutil.MockTagRepository{}, ai, nil, nil)
	resolver := NewResolver(postSvc, service.NewTagService(&testutil.MockTagRepository{}, nil))

	posts, err := resolver.Post().Related(context.Background(), &model.Post{ID: "p_1"}, nil)
	require.NoError(t, err)
	assert.Empty(t, posts)
}

func TestMapDomainError(t *testing.T) {
	require.Error(t, mapDomainError(domain.ErrUnauthorized))
	assert.Equal(t, "unauthorized", mapDomainError(domain.ErrUnauthorized).Message)
	assert.Equal(t, "forbidden", mapDomainError(domain.ErrForbidden).Message)
	assert.Equal(t, "not found", mapDomainError(domain.ErrNotFound).Message)
	generic := mapDomainError(errors.New("boom"))
	assert.Contains(t, generic.Error(), "boom")
}

func TestMapDomainPostToModel(t *testing.T) {
	post := mapDomainPostToModel(nil)
	assert.Nil(t, post)

	mapped := mapDomainPostToModel(&domain.Post{ID: "p_1", Title: "T", Summary: "S", SummaryStatus: domain.PostStatusCompleted, Tags: []string{"go"}})
	require.NotNil(t, mapped)
	assert.Equal(t, "p_1", mapped.ID)
	require.NotNil(t, mapped.SummaryStatus)
	assert.Equal(t, model.SummaryStatusCompleted, *mapped.SummaryStatus)
	require.Len(t, mapped.Tags, 1)
	assert.Equal(t, "go", mapped.Tags[0].Name)
}

func TestDeref(t *testing.T) {
	assert.Equal(t, 0, deref(nil))
	assert.Equal(t, 42, deref(intPtr(42)))
}

func intPtr(v int) *int       { return &v }
func strPtr(v string) *string { return &v }
