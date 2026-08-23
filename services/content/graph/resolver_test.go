package graph

import (
	"context"
	"errors"
	"testing"

	"net/http"
	"net/http/httptest"

	"github.com/99designs/gqlgen/graphql"
	"github.com/kunalPisolkar24/topos/services/content/graph/model"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
	"github.com/kunalPisolkar24/topos/services/content/internal/middleware"
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	promtestutil "github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vektah/gqlparser/v2/ast"
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
	chatSvc := service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{})
	interactionSvc := service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil)
	draftSvc := service.NewPostDraftService(&testutil.MockPostDraftRepository{}, &testutil.MockAIService{}, postSvc)
	return NewResolver(postSvc, tagSvc, chatSvc, interactionSvc, draftSvc), postSvc, tagSvc
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
	resolver := NewResolver(postSvc, service.NewTagService(&testutil.MockTagRepository{}, nil), service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{}), service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, ai, postSvc))

	result, err := resolver.Query().SearchPosts(context.Background(), "go", intPtr(1), intPtr(10))

	require.NoError(t, err)
	assert.Equal(t, 1, result.Total)
	require.Len(t, result.Hits, 1)
	assert.Equal(t, "p_1", result.Hits[0].ID)
	assert.Equal(t, "Hello", result.Hits[0].Title)
}

func TestQueryResolverRecommendedPosts(t *testing.T) {
	ai := &testutil.MockAIService{RecommendFeedFn: func(ctx context.Context, userID string, offset, limit int, mode domain.RecommendMode, seed uint32) (*domain.SearchResult, error) {
		assert.Equal(t, "u_1", userID)
		assert.Equal(t, 0, offset)
		assert.Equal(t, 10, limit)
		assert.Equal(t, domain.RecommendModeSurprise, mode)
		assert.Equal(t, uint32(42), seed)
		return &domain.SearchResult{PostIDs: []string{"p_1"}, Total: 3}, nil
	}}
	postRepo := &testutil.MockPostRepository{FindByIDsFn: func(ctx context.Context, ids []string) ([]*domain.Post, error) {
		return []*domain.Post{{ID: "p_1", Title: "Hello", AuthorID: "u_2"}}, nil
	}}
	postSvc := service.NewPostService(postRepo, &testutil.MockTagRepository{}, ai, nil, nil)
	resolver := NewResolver(postSvc, service.NewTagService(&testutil.MockTagRepository{}, nil), service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{}), service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, ai, postSvc))

	mode, seed := model.RecommendModeSurprise, 42
	servedBefore := promtestutil.ToFloat64(metrics.RecommendFeedServedTotal.WithLabelValues(string(domain.RecommendModeSurprise)))
	result, err := resolver.Query().RecommendedPosts(authenticatedContext("u_1"), intPtr(1), intPtr(10), &mode, &seed)

	require.NoError(t, err)
	require.Len(t, result.Posts, 1)
	assert.Equal(t, "p_1", result.Posts[0].ID)
	assert.Equal(t, "Hello", result.Posts[0].Title)
	assert.Equal(t, 3, result.TotalPosts)
	assert.Equal(t, servedBefore+1, promtestutil.ToFloat64(metrics.RecommendFeedServedTotal.WithLabelValues(string(domain.RecommendModeSurprise))), "each successful feed response counts as served")
}

func TestQueryResolverRecommendedPostsUnauthorized(t *testing.T) {
	resolver, _, _ := newTestResolver(t, nil, nil)

	_, err := resolver.Query().RecommendedPosts(context.Background(), nil, nil, nil, nil)

	require.Error(t, err)
	assert.Equal(t, "unauthorized", err.(*gqlerror.Error).Message)
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
	resolver := NewResolver(postSvc, service.NewTagService(nil, nil), service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{}), service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, &testutil.MockAIService{}, postSvc))

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
	resolver := NewResolver(postSvc, service.NewTagService(nil, nil), service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{}), service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, &testutil.MockAIService{}, postSvc))

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
	resolver := NewResolver(postSvc, service.NewTagService(&testutil.MockTagRepository{}, nil), service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{}), service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, ai, postSvc))

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
	resolver := NewResolver(postSvc, service.NewTagService(&testutil.MockTagRepository{}, nil), service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{}), service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, ai, postSvc))

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
	assert.Equal(t, "internal error", generic.Message, "unexpected errors must never leak internal details")
}

func presentCtx() context.Context {
	return graphql.WithOperationContext(context.Background(), &graphql.OperationContext{})
}

func TestPresentErrorMasksInternalDetails(t *testing.T) {
	ctx := presentCtx()

	out := PresentError(ctx, errors.New("mongo: connection refused at 10.0.0.5:27017"))
	assert.Equal(t, "internal error", out.Message)
	assert.NotContains(t, out.Message, "mongo")
	assert.NotContains(t, out.Message, "10.0.0.5")
}

func TestPresentErrorPassesSafeMessages(t *testing.T) {
	ctx := presentCtx()

	for _, tc := range []struct {
		err     error
		message string
	}{
		{domain.ErrUnauthorized, "unauthorized"},
		{domain.ErrForbidden, "forbidden"},
		{domain.ErrNotFound, "not found"},
	} {
		out := PresentError(ctx, mapDomainError(tc.err))
		assert.Equal(t, tc.message, out.Message)
	}

	out := PresentError(ctx, &gqlerror.Error{Message: "validation failed", Path: ast.Path{ast.PathName("createPost")}})
	assert.Equal(t, "validation failed", out.Message)
}

func TestPresentErrorAddsRequestIDExtension(t *testing.T) {
	handler := middleware.RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := graphql.WithOperationContext(r.Context(), &graphql.OperationContext{})
		out := PresentError(ctx, mapDomainError(domain.ErrForbidden))
		assert.Equal(t, "forbidden", out.Message)
		rid, _ := out.Extensions["request_id"].(string)
		assert.NotEmpty(t, rid)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	handler.ServeHTTP(httptest.NewRecorder(), req)
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

func TestMutationResolverCreateChat(t *testing.T) {
	repo := &testutil.MockChatRepository{}
	chatSvc := service.NewChatService(repo, &testutil.MockAIService{})
	resolver := NewResolver(service.NewPostService(&testutil.MockPostRepository{}, nil, nil, nil, nil), service.NewTagService(nil, nil), chatSvc, service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, &testutil.MockAIService{}, nil))

	chat, err := resolver.Mutation().CreateChat(authenticatedContext("u_1"), strPtr("My Chat"))

	require.NoError(t, err)
	assert.Equal(t, "My Chat", chat.Title)
	assert.NotEmpty(t, chat.CreatedAt)
}

func TestMutationResolverCreateChatUnauthorized(t *testing.T) {
	repo := &testutil.MockChatRepository{}
	chatSvc := service.NewChatService(repo, &testutil.MockAIService{})
	resolver := NewResolver(service.NewPostService(&testutil.MockPostRepository{}, nil, nil, nil, nil), service.NewTagService(nil, nil), chatSvc, service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, &testutil.MockAIService{}, nil))

	_, err := resolver.Mutation().CreateChat(context.Background(), strPtr("My Chat"))

	require.Error(t, err)
	assert.Contains(t, err.Error(), "unauthorized")
}

func TestMutationResolverAskChat(t *testing.T) {
	ai := &testutil.MockAIService{ChatAnswerFn: func(ctx context.Context, threadID, query string, history []domain.ChatTurn, topK int) (*domain.ChatAnswer, error) {
		return &domain.ChatAnswer{Content: "Topos is a blog platform.", CitedPostIDs: []string{"p_1"}}, nil
	}}
	repo := &testutil.MockChatRepository{UserID: "u_1"}
	chatSvc := service.NewChatService(repo, ai)
	resolver := NewResolver(service.NewPostService(&testutil.MockPostRepository{}, nil, nil, nil, nil), service.NewTagService(nil, nil), chatSvc, service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, &testutil.MockAIService{}, nil))

	msg, err := resolver.Mutation().AskChat(authenticatedContext("u_1"), "c_1", "what is topos?")

	require.NoError(t, err)
	assert.Equal(t, model.MessageRoleAssistant, msg.Role)
	assert.Equal(t, "Topos is a blog platform.", msg.Content)
	assert.Equal(t, []string{"p_1"}, msg.CitedPostIds)
	assert.NotEmpty(t, msg.CreatedAt)
}

func TestQueryResolverChats(t *testing.T) {
	repo := &testutil.MockChatRepository{
		UserID: "u_1",
		ListByUserFn: func(ctx context.Context, userID string, page, limit int) (*domain.PaginatedChats, error) {
			assert.Equal(t, "u_1", userID)
			assert.Equal(t, 1, page)
			assert.Equal(t, 10, limit)
			return &domain.PaginatedChats{
				Chats:      []*domain.Chat{{ID: "c_1", UserID: "u_1", Title: "My Chat"}},
				TotalChats: 1,
				TotalPages: 1,
				Page:       page,
			}, nil
		},
	}
	chatSvc := service.NewChatService(repo, &testutil.MockAIService{})
	resolver := NewResolver(service.NewPostService(&testutil.MockPostRepository{}, nil, nil, nil, nil), service.NewTagService(nil, nil), chatSvc, service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, &testutil.MockAIService{}, nil))

	chats, err := resolver.Query().Chats(authenticatedContext("u_1"), nil, nil)

	require.NoError(t, err)
	require.Len(t, chats.Chats, 1)
	assert.Equal(t, "c_1", chats.Chats[0].ID)
	assert.Equal(t, "My Chat", chats.Chats[0].Title)
	assert.Equal(t, 1, chats.TotalPages)
}

func TestQueryResolverChatsPaginated(t *testing.T) {
	repo := &testutil.MockChatRepository{
		UserID: "u_1",
		ListByUserFn: func(ctx context.Context, userID string, page, limit int) (*domain.PaginatedChats, error) {
			assert.Equal(t, 2, page)
			assert.Equal(t, 5, limit)
			return &domain.PaginatedChats{Chats: nil, TotalChats: 12, TotalPages: 3, Page: page}, nil
		},
	}
	chatSvc := service.NewChatService(repo, &testutil.MockAIService{})
	resolver := NewResolver(service.NewPostService(&testutil.MockPostRepository{}, nil, nil, nil, nil), service.NewTagService(nil, nil), chatSvc, service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, &testutil.MockAIService{}, nil))

	page, limit := 2, 5
	chats, err := resolver.Query().Chats(authenticatedContext("u_1"), &page, &limit)

	require.NoError(t, err)
	assert.Equal(t, 2, chats.CurrentPage)
	assert.Equal(t, 12, chats.TotalChats)
}

func TestQueryResolverChatsUnauthorized(t *testing.T) {
	chatSvc := service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{})
	resolver := NewResolver(service.NewPostService(&testutil.MockPostRepository{}, nil, nil, nil, nil), service.NewTagService(nil, nil), chatSvc, service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, &testutil.MockAIService{}, nil))

	_, err := resolver.Query().Chats(context.Background(), nil, nil)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "unauthorized")
}

func TestMapDomainChatMessageToModel(t *testing.T) {
	msg := mapDomainChatMessageToModel(nil)
	assert.Nil(t, msg)

	mapped := mapDomainChatMessageToModel(&domain.ChatMessage{
		ID:           "m_1",
		ChatID:       "c_1",
		Role:         domain.ChatMessageRoleAssistant,
		Content:      "hi",
		CitedPostIDs: []string{"p_1"},
	})
	require.NotNil(t, mapped)
	assert.Equal(t, model.MessageRoleAssistant, mapped.Role)
	assert.Equal(t, []string{"p_1"}, mapped.CitedPostIds)

	userMapped := mapDomainChatMessageToModel(&domain.ChatMessage{Role: domain.ChatMessageRoleUser})
	assert.Equal(t, model.MessageRoleUser, userMapped.Role)
}

func intPtr(v int) *int       { return &v }
func strPtr(v string) *string { return &v }

func newTestInteractionResolver(t *testing.T, repo *testutil.MockPostInteractionRepository, publisher *testutil.MockEventPublisher) (*Resolver, *testutil.MockPostInteractionRepository, *testutil.MockEventPublisher) {
	t.Helper()
	if repo == nil {
		repo = &testutil.MockPostInteractionRepository{}
	}
	if publisher == nil {
		publisher = &testutil.MockEventPublisher{}
	}
	interactionSvc := service.NewPostInteractionService(repo, publisher, nil)
	resolver := NewResolver(
		service.NewPostService(&testutil.MockPostRepository{}, &testutil.MockTagRepository{}, nil, nil, nil),
		service.NewTagService(&testutil.MockTagRepository{}, nil),
		service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{}),
		interactionSvc,
		service.NewPostDraftService(&testutil.MockPostDraftRepository{}, &testutil.MockAIService{}, nil),
	)
	return resolver, repo, publisher
}

func TestMutationResolverRecordPostView(t *testing.T) {
	resolver, repo, publisher := newTestInteractionResolver(t, nil, nil)

	ok, err := resolver.Mutation().RecordPostView(authenticatedContext("u_1"), "p_1", nil)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, 1, repo.RecordCalls)
	require.Len(t, publisher.Interacted, 1)
	assert.Equal(t, "u_1", publisher.Interacted[0].UserID)
	assert.Equal(t, "p_1", publisher.Interacted[0].PostID)
}

func TestMutationResolverRecordPostViewDuplicateNeverErrors(t *testing.T) {
	repo := &testutil.MockPostInteractionRepository{
		RecordFn: func(ctx context.Context, interaction *domain.PostInteraction) (*domain.PostInteraction, error) {
			interaction.ID = "existing"
			return interaction, nil
		},
	}
	resolver, _, _ := newTestInteractionResolver(t, repo, nil)

	_, err := resolver.Mutation().RecordPostView(authenticatedContext("u_1"), "p_1", nil)
	require.NoError(t, err)
	_, err = resolver.Mutation().RecordPostView(authenticatedContext("u_1"), "p_1", nil)
	require.NoError(t, err, "duplicate views never error the UI")
}

func TestMutationResolverRecordPostViewUnauthorized(t *testing.T) {
	resolver, _, _ := newTestInteractionResolver(t, nil, nil)

	_, err := resolver.Mutation().RecordPostView(context.Background(), "p_1", nil)
	require.Error(t, err)
	assert.Equal(t, "unauthorized", err.(*gqlerror.Error).Message)
}

func TestMutationResolverLikePostToggles(t *testing.T) {
	repo := &testutil.MockPostInteractionRepository{}
	resolver, repo, publisher := newTestInteractionResolver(t, repo, nil)

	liked, err := resolver.Mutation().LikePost(authenticatedContext("u_1"), "p_1", nil)
	require.NoError(t, err)
	assert.True(t, liked, "first toggle likes the post")
	assert.Equal(t, 1, repo.RecordCalls)
	require.Len(t, publisher.Interacted, 1)
	assert.Equal(t, domain.PostInteractionLike, publisher.Interacted[0].Kind)

	repo.FindByUserPostAndKindFn = func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) (*domain.PostInteraction, error) {
		return &domain.PostInteraction{ID: "i_1", UserID: userID, PostID: postID, Kind: kind}, nil
	}

	liked, err = resolver.Mutation().LikePost(authenticatedContext("u_1"), "p_1", nil)
	require.NoError(t, err)
	assert.False(t, liked, "second toggle unlikes the post")
	assert.Equal(t, 1, repo.DeleteCalls)
}

func TestMutationResolverSavePostToggles(t *testing.T) {
	resolver, repo, _ := newTestInteractionResolver(t, nil, nil)

	saved, err := resolver.Mutation().SavePost(authenticatedContext("u_1"), "p_1", nil)
	require.NoError(t, err)
	assert.True(t, saved)
	assert.Equal(t, domain.PostInteractionSave, repo.FindByUserPostKind)
}

func TestQueryResolverRecommendedPostsCountsDefaultMode(t *testing.T) {
	ai := &testutil.MockAIService{RecommendFeedFn: func(ctx context.Context, userID string, offset, limit int, mode domain.RecommendMode, seed uint32) (*domain.SearchResult, error) {
		assert.Equal(t, domain.RecommendModeDefault, mode)
		return &domain.SearchResult{PostIDs: []string{"p_1"}, Total: 1}, nil
	}}
	postRepo := &testutil.MockPostRepository{FindByIDsFn: func(ctx context.Context, ids []string) ([]*domain.Post, error) {
		return []*domain.Post{{ID: "p_1", Title: "Hello", AuthorID: "u_2"}}, nil
	}}
	postSvc := service.NewPostService(postRepo, &testutil.MockTagRepository{}, ai, nil, nil)
	resolver := NewResolver(postSvc, service.NewTagService(&testutil.MockTagRepository{}, nil), service.NewChatService(&testutil.MockChatRepository{}, &testutil.MockAIService{}), service.NewPostInteractionService(&testutil.MockPostInteractionRepository{}, &testutil.MockEventPublisher{}, nil), service.NewPostDraftService(&testutil.MockPostDraftRepository{}, ai, postSvc))
	servedBefore := promtestutil.ToFloat64(metrics.RecommendFeedServedTotal.WithLabelValues(string(domain.RecommendModeDefault)))

	mode := model.RecommendModeDefault
	result, err := resolver.Query().RecommendedPosts(authenticatedContext("u_1"), intPtr(1), intPtr(10), &mode, nil)

	require.NoError(t, err)
	require.Len(t, result.Posts, 1)
	assert.Equal(t, servedBefore+1, promtestutil.ToFloat64(metrics.RecommendFeedServedTotal.WithLabelValues(string(domain.RecommendModeDefault))))
}

func TestMutationResolverRecordPostViewForwardsMode(t *testing.T) {
	resolver, _, publisher := newTestInteractionResolver(t, nil, nil)
	mode := model.RecommendModeSurprise

	ok, err := resolver.Mutation().RecordPostView(authenticatedContext("u_1"), "p_1", &mode)
	require.NoError(t, err)
	assert.True(t, ok)
	require.Len(t, publisher.Interacted, 1)
	assert.Equal(t, domain.RecommendModeSurprise, publisher.Interacted[0].Mode, "the feed mode reaches the interaction event")
}

func TestMutationResolverLikePostForwardsMode(t *testing.T) {
	resolver, _, publisher := newTestInteractionResolver(t, nil, nil)
	mode := model.RecommendModeSurprise

	liked, err := resolver.Mutation().LikePost(authenticatedContext("u_1"), "p_1", &mode)
	require.NoError(t, err)
	assert.True(t, liked)
	require.Len(t, publisher.Interacted, 1)
	assert.Equal(t, domain.RecommendModeSurprise, publisher.Interacted[0].Mode)
}

func TestMutationResolverInteractionWithoutModeStaysUnattributed(t *testing.T) {
	resolver, _, publisher := newTestInteractionResolver(t, nil, nil)

	ok, err := resolver.Mutation().RecordPostView(authenticatedContext("u_1"), "p_1", nil)
	require.NoError(t, err)
	assert.True(t, ok)
	require.Len(t, publisher.Interacted, 1)
	assert.Empty(t, publisher.Interacted[0].Mode, "no mode arg means no feed attribution")
}

func TestMutationResolverToggleUnauthorized(t *testing.T) {
	for name, mutate := range map[string]func(resolver *Resolver) (bool, error){
		"likePost": func(r *Resolver) (bool, error) { return r.Mutation().LikePost(context.Background(), "p_1", nil) },
		"savePost": func(r *Resolver) (bool, error) { return r.Mutation().SavePost(context.Background(), "p_1", nil) },
	} {
		t.Run(name, func(t *testing.T) {
			resolver, _, _ := newTestInteractionResolver(t, nil, nil)

			_, err := mutate(resolver)
			require.Error(t, err)
			assert.Equal(t, "unauthorized", err.(*gqlerror.Error).Message)
		})
	}
}

func TestPostResolverLikedByMeReflectsUserState(t *testing.T) {
	repo := &testutil.MockPostInteractionRepository{
		ListStatesFn: func(ctx context.Context, userID string, postIDs []string) (map[string]domain.PostInteractionState, error) {
			assert.Equal(t, "u_1", userID)
			return map[string]domain.PostInteractionState{
				"p_1": {Liked: true},
				"p_2": {Saved: true},
			}, nil
		},
	}
	resolver, _, _ := newTestInteractionResolver(t, repo, nil)

	liked, err := resolver.Post().LikedByMe(authenticatedContext("u_1"), &model.Post{ID: "p_1"})
	require.NoError(t, err)
	assert.True(t, liked, "the requesting user liked p_1")

	liked, err = resolver.Post().LikedByMe(authenticatedContext("u_1"), &model.Post{ID: "p_2"})
	require.NoError(t, err)
	assert.False(t, liked, "p_2 was only saved, never liked")

	liked, err = resolver.Post().LikedByMe(authenticatedContext("u_1"), &model.Post{ID: "p_unknown"})
	require.NoError(t, err)
	assert.False(t, liked, "a post with no interactions is not liked")
}

func TestPostResolverSavedByMeReflectsUserState(t *testing.T) {
	repo := &testutil.MockPostInteractionRepository{
		ListStatesFn: func(ctx context.Context, userID string, postIDs []string) (map[string]domain.PostInteractionState, error) {
			return map[string]domain.PostInteractionState{
				"p_1": {Liked: true},
				"p_2": {Saved: true},
			}, nil
		},
	}
	resolver, _, _ := newTestInteractionResolver(t, repo, nil)

	saved, err := resolver.Post().SavedByMe(authenticatedContext("u_1"), &model.Post{ID: "p_2"})
	require.NoError(t, err)
	assert.True(t, saved, "the requesting user saved p_2")

	saved, err = resolver.Post().SavedByMe(authenticatedContext("u_1"), &model.Post{ID: "p_1"})
	require.NoError(t, err)
	assert.False(t, saved, "p_1 was only liked, never saved")
}

func TestPostResolverInteractionStateAnonymous(t *testing.T) {
	repo := &testutil.MockPostInteractionRepository{
		ListStatesFn: func(ctx context.Context, userID string, postIDs []string) (map[string]domain.PostInteractionState, error) {
			t.Fatal("anonymous callers must not trigger state lookups")
			return nil, nil
		},
	}
	resolver, _, _ := newTestInteractionResolver(t, repo, nil)

	liked, err := resolver.Post().LikedByMe(context.Background(), &model.Post{ID: "p_1"})
	require.NoError(t, err)
	assert.False(t, liked, "anonymous callers are never shown as liking a post")

	saved, err := resolver.Post().SavedByMe(context.Background(), &model.Post{ID: "p_1"})
	require.NoError(t, err)
	assert.False(t, saved, "anonymous callers are never shown as saving a post")
}

func TestPostResolverInteractionStatePropagatesErrors(t *testing.T) {
	repo := &testutil.MockPostInteractionRepository{
		ListStatesFn: func(ctx context.Context, userID string, postIDs []string) (map[string]domain.PostInteractionState, error) {
			return nil, errors.New("mongo down")
		},
	}
	resolver, _, _ := newTestInteractionResolver(t, repo, nil)

	_, err := resolver.Post().LikedByMe(authenticatedContext("u_1"), &model.Post{ID: "p_1"})
	require.Error(t, err)
}
