// Package testutil provides hand-written fakes for the domain
// interfaces, shared by the service, worker and graph test suites.
package testutil

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

type MockPostRepository struct {
	CreateFn        func(ctx context.Context, post *domain.Post) (*domain.Post, error)
	UpdateFn        func(ctx context.Context, id string, post *domain.Post) (*domain.Post, error)
	UpdateSummaryFn func(ctx context.Context, id, summary string, status domain.PostStatus) error
	DeleteFn        func(ctx context.Context, id string) error
	FindAllFn       func(ctx context.Context, page, limit int) (*domain.PaginatedPosts, error)
	FindByIDFn      func(ctx context.Context, id string) (*domain.Post, error)
	FindByIDsFn     func(ctx context.Context, ids []string) ([]*domain.Post, error)
	FindByAuthorFn  func(ctx context.Context, authorID string, page, limit int) (*domain.PaginatedPosts, error)
	FindByTagFn     func(ctx context.Context, tag string, page, limit int) (*domain.PaginatedPosts, error)

	CreateCalls int
}

func (m *MockPostRepository) Create(ctx context.Context, post *domain.Post) (*domain.Post, error) {
	m.CreateCalls++
	if m.CreateFn != nil {
		return m.CreateFn(ctx, post)
	}
	post.ID = "id-created"
	return post, nil
}

func (m *MockPostRepository) Update(ctx context.Context, id string, post *domain.Post) (*domain.Post, error) {
	if m.UpdateFn != nil {
		return m.UpdateFn(ctx, id, post)
	}
	return &domain.Post{ID: id}, nil
}

func (m *MockPostRepository) UpdateSummary(ctx context.Context, id, summary string, status domain.PostStatus) error {
	if m.UpdateSummaryFn != nil {
		return m.UpdateSummaryFn(ctx, id, summary, status)
	}
	return nil
}

func (m *MockPostRepository) Delete(ctx context.Context, id string) error {
	if m.DeleteFn != nil {
		return m.DeleteFn(ctx, id)
	}
	return nil
}

func (m *MockPostRepository) FindAll(ctx context.Context, page, limit int) (*domain.PaginatedPosts, error) {
	if m.FindAllFn != nil {
		return m.FindAllFn(ctx, page, limit)
	}
	return &domain.PaginatedPosts{Page: page}, nil
}

func (m *MockPostRepository) FindByID(ctx context.Context, id string) (*domain.Post, error) {
	if m.FindByIDFn != nil {
		return m.FindByIDFn(ctx, id)
	}
	return &domain.Post{ID: id}, nil
}

func (m *MockPostRepository) FindByIDs(ctx context.Context, ids []string) ([]*domain.Post, error) {
	if m.FindByIDsFn != nil {
		return m.FindByIDsFn(ctx, ids)
	}
	posts := make([]*domain.Post, 0, len(ids))
	for _, id := range ids {
		posts = append(posts, &domain.Post{ID: id})
	}
	return posts, nil
}

func (m *MockPostRepository) FindByAuthor(ctx context.Context, authorID string, page, limit int) (*domain.PaginatedPosts, error) {
	if m.FindByAuthorFn != nil {
		return m.FindByAuthorFn(ctx, authorID, page, limit)
	}
	return &domain.PaginatedPosts{Page: page}, nil
}

func (m *MockPostRepository) FindByTag(ctx context.Context, tag string, page, limit int) (*domain.PaginatedPosts, error) {
	if m.FindByTagFn != nil {
		return m.FindByTagFn(ctx, tag, page, limit)
	}
	return &domain.PaginatedPosts{Page: page}, nil
}

type MockTagRepository struct {
	CreateOrFindFn func(ctx context.Context, name string) (*domain.Tag, error)
	FindAllFn      func(ctx context.Context) ([]*domain.Tag, error)
	SearchFn       func(ctx context.Context, query string, limit int) ([]*domain.Tag, error)
}

func (m *MockTagRepository) CreateOrFind(ctx context.Context, name string) (*domain.Tag, error) {
	if m.CreateOrFindFn != nil {
		return m.CreateOrFindFn(ctx, name)
	}
	return &domain.Tag{ID: name, Name: name}, nil
}

func (m *MockTagRepository) FindAll(ctx context.Context) ([]*domain.Tag, error) {
	if m.FindAllFn != nil {
		return m.FindAllFn(ctx)
	}
	return nil, nil
}

func (m *MockTagRepository) Search(ctx context.Context, query string, limit int) ([]*domain.Tag, error) {
	if m.SearchFn != nil {
		return m.SearchFn(ctx, query, limit)
	}
	return nil, nil
}

type MockAIService struct {
	GenerateSummaryFn func(ctx context.Context, text string) (string, error)
	GenerateTagsFn    func(ctx context.Context, title, body string) ([]string, error)
	GeneratePostFn    func(ctx context.Context, prompt string) (*domain.GeneratedPost, error)
	IndexPostFn       func(ctx context.Context, postID, title, body, summary string, tags []string, createdAt time.Time) error
	DeletePostFn      func(ctx context.Context, postID string) error
	SearchPostsFn     func(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error)
}

func (m *MockAIService) GenerateSummary(ctx context.Context, text string) (string, error) {
	if m.GenerateSummaryFn != nil {
		return m.GenerateSummaryFn(ctx, text)
	}
	return "", nil
}

func (m *MockAIService) GenerateTags(ctx context.Context, title, body string) ([]string, error) {
	if m.GenerateTagsFn != nil {
		return m.GenerateTagsFn(ctx, title, body)
	}
	return nil, nil
}

func (m *MockAIService) GeneratePost(ctx context.Context, prompt string) (*domain.GeneratedPost, error) {
	if m.GeneratePostFn != nil {
		return m.GeneratePostFn(ctx, prompt)
	}
	return &domain.GeneratedPost{}, nil
}

func (m *MockAIService) IndexPost(ctx context.Context, postID, title, body, summary string, tags []string, createdAt time.Time) error {
	if m.IndexPostFn != nil {
		return m.IndexPostFn(ctx, postID, title, body, summary, tags, createdAt)
	}
	return nil
}

func (m *MockAIService) DeletePost(ctx context.Context, postID string) error {
	if m.DeletePostFn != nil {
		return m.DeletePostFn(ctx, postID)
	}
	return nil
}

func (m *MockAIService) SearchPosts(ctx context.Context, query string, offset, limit int) (*domain.SearchResult, error) {
	if m.SearchPostsFn != nil {
		return m.SearchPostsFn(ctx, query, offset, limit)
	}
	return &domain.SearchResult{}, nil
}

func (m *MockAIService) Close() error { return nil }

// MockEventPublisher records every event it is asked to publish.
type MockEventPublisher struct {
	Err         error
	Created     []*domain.Post
	Updated     []*domain.Post
	Deleted     []string
	DeadLetters []DeadLetter
}

type DeadLetter struct {
	OriginalTopic string
	DLQTopic      string
	Key           []byte
	Value         []byte
	Cause         error
}

func (m *MockEventPublisher) PublishPostCreated(ctx context.Context, post *domain.Post) error {
	m.Created = append(m.Created, post)
	return m.Err
}

func (m *MockEventPublisher) PublishPostUpdated(ctx context.Context, post *domain.Post) error {
	m.Updated = append(m.Updated, post)
	return m.Err
}

func (m *MockEventPublisher) PublishPostDeleted(ctx context.Context, id string) error {
	m.Deleted = append(m.Deleted, id)
	return m.Err
}

func (m *MockEventPublisher) PublishDeadLetter(ctx context.Context, originalTopic, dlqTopic string, key, value []byte, cause error) error {
	m.DeadLetters = append(m.DeadLetters, DeadLetter{
		OriginalTopic: originalTopic,
		DLQTopic:      dlqTopic,
		Key:           key,
		Value:         value,
		Cause:         cause,
	})
	return m.Err
}

// MockSummaryProcessor fakes the worker's post store.
type MockSummaryProcessor struct {
	GetPostFn func(ctx context.Context, id string) (*domain.Post, error)
	SetFn     func(ctx context.Context, id, summary string, status domain.PostStatus) error

	SummaryStatus domain.PostStatus
}

func (m *MockSummaryProcessor) GetPost(ctx context.Context, id string) (*domain.Post, error) {
	if m.GetPostFn != nil {
		return m.GetPostFn(ctx, id)
	}
	return &domain.Post{ID: id}, nil
}

func (m *MockSummaryProcessor) SetPostSummary(ctx context.Context, id, summary string, status domain.PostStatus) error {
	m.SummaryStatus = status
	if m.SetFn != nil {
		return m.SetFn(ctx, id, summary, status)
	}
	return nil
}
