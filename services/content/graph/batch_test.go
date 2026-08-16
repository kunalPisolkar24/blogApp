package graph

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestBatcher[T any](t *testing.T, fn func(context.Context, []string) (map[string]T, map[string]error)) *batcher[T] {
	t.Helper()
	return newBatcher(context.Background(), fn)
}

func TestBatcherCoalescesBurstIntoOneBatch(t *testing.T) {
	release := make(chan struct{})
	var batches atomic.Int32
	b := newTestBatcher(t, func(ctx context.Context, ids []string) (map[string]int, map[string]error) {
		if batches.Add(1) == 1 {
			<-release
		}
		results := make(map[string]int, len(ids))
		for _, id := range ids {
			results[id] = 1
		}
		return results, nil
	})

	const callers = 8
	start := make(chan struct{})
	var ready sync.WaitGroup
	ready.Add(callers)
	errs := make(chan error, callers)
	for i := 0; i < callers; i++ {
		go func(i int) {
			ready.Done()
			<-start
			got, err := b.get(context.Background(), string(rune('a'+i)))
			if err == nil && got != 1 {
				err = errors.New("unexpected value")
			}
			errs <- err
		}(i)
	}
	ready.Wait()
	close(start)
	time.Sleep(2 * time.Millisecond)
	close(release)

	for i := 0; i < callers; i++ {
		require.NoError(t, <-errs)
	}
	assert.Equal(t, int32(1), batches.Load(), "a burst must share a single batch")
}

func TestBatcherDedupesRepeatedIds(t *testing.T) {
	var calls atomic.Int32
	b := newTestBatcher(t, func(ctx context.Context, ids []string) (map[string]int, map[string]error) {
		calls.Add(1)
		results := make(map[string]int, len(ids))
		for _, id := range ids {
			results[id] = 42
		}
		return results, nil
	})

	got, err := b.get(context.Background(), "p_1")
	require.NoError(t, err)
	assert.Equal(t, 42, got)

	got, err = b.get(context.Background(), "p_1")
	require.NoError(t, err)
	assert.Equal(t, 42, got)
}

func TestBatcherPropagatesBatchError(t *testing.T) {
	wantErr := errors.New("ai down")
	b := newTestBatcher(t, func(ctx context.Context, ids []string) (map[string]int, map[string]error) {
		errs := make(map[string]error, len(ids))
		for _, id := range ids {
			errs[id] = wantErr
		}
		return nil, errs
	})

	_, err := b.get(context.Background(), "p_1")
	assert.ErrorIs(t, err, wantErr)
}

func TestBatcherMissingIdGetsZeroValue(t *testing.T) {
	b := newTestBatcher(t, func(ctx context.Context, ids []string) (map[string]int, map[string]error) {
		return map[string]int{"p_1": 7}, nil
	})

	got, err := b.get(context.Background(), "p_2")
	require.NoError(t, err)
	assert.Zero(t, got, "an id missing from the batch result yields the zero value, not an error")
}

func TestBatcherAbortsOnCancellation(t *testing.T) {
	b := newTestBatcher(t, func(ctx context.Context, ids []string) (map[string]int, map[string]error) {
		select {
		case <-ctx.Done():
			errs := make(map[string]error, len(ids))
			for _, id := range ids {
				errs[id] = ctx.Err()
			}
			return nil, errs
		case <-time.After(time.Second):
			return map[string]int{}, nil
		}
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := b.get(ctx, "p_1")
		done <- err
	}()
	time.Sleep(2 * time.Millisecond)
	cancel()

	assert.ErrorIs(t, <-done, context.Canceled)
}

func newTestResolverPostService(t *testing.T) (*service.PostService, error) {
	t.Helper()

	repo := &testutil.MockPostRepository{
		FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
			if id == "missing" {
				return nil, domain.ErrNotFound
			}
			return &domain.Post{ID: id}, nil
		},
		FindByIDsFn: func(ctx context.Context, ids []string) ([]*domain.Post, error) {
			var posts []*domain.Post
			for _, id := range ids {
				if id != "missing" {
					posts = append(posts, &domain.Post{ID: id})
				}
			}
			return posts, nil
		},
	}
	svc := service.NewPostService(repo, &testutil.MockTagRepository{}, &testutil.MockAIService{}, nil, nil)
	return svc, nil
}

func TestRelatedPostsFromFallsBackWithoutRegistry(t *testing.T) {
	svc, err := newTestResolverPostService(t)
	require.NoError(t, err)

	posts, err := relatedPostsFrom(context.Background(), svc, "p_1", 5)
	require.NoError(t, err)
	assert.NotNil(t, posts)
}

func TestPostByIDFromFallsBackWithoutRegistry(t *testing.T) {
	svc, err := newTestResolverPostService(t)
	require.NoError(t, err)

	post, err := postByIDFrom(context.Background(), svc, "p_1")
	require.NoError(t, err)
	assert.NotNil(t, post)
}

func TestPostByIDFromReturnsNotFoundForMissing(t *testing.T) {
	svc, err := newTestResolverPostService(t)
	require.NoError(t, err)

	_, err = postByIDFrom(context.Background(), svc, "missing")
	assert.ErrorIs(t, err, domain.ErrNotFound)
}

func TestInteractionStatesFromSharesOneLookupPerRequest(t *testing.T) {
	var calls atomic.Int32
	repo := &testutil.MockPostInteractionRepository{
		ListStatesFn: func(ctx context.Context, userID string, postIDs []string) (map[string]domain.PostInteractionState, error) {
			calls.Add(1)
			states := make(map[string]domain.PostInteractionState, len(postIDs))
			for _, id := range postIDs {
				states[id] = domain.PostInteractionState{Liked: true}
			}
			return states, nil
		},
	}
	interactionSvc := service.NewPostInteractionService(repo, &testutil.MockEventPublisher{}, nil)
	reg := &batchRegistry{
		interactionSvc: interactionSvc,
		states:         make(map[string]*batcher[domain.PostInteractionState]),
	}
	ctx := context.WithValue(context.Background(), batchRegistryKey{}, reg)

	start := make(chan struct{})
	errs := make(chan error, 2)
	for _, postID := range []string{"p_1", "p_2"} {
		go func(postID string) {
			<-start
			state, err := interactionStatesFrom(ctx, interactionSvc, "u_1", postID)
			if err == nil && !state.Liked {
				err = errors.New("unexpected state")
			}
			errs <- err
		}(postID)
	}
	close(start)

	for i := 0; i < 2; i++ {
		require.NoError(t, <-errs)
	}
	assert.Equal(t, int32(1), calls.Load(), "all posts of a request share a single state lookup")
}

func TestInteractionStatesFromFallsBackWithoutRegistry(t *testing.T) {
	repo := &testutil.MockPostInteractionRepository{
		ListStatesFn: func(ctx context.Context, userID string, postIDs []string) (map[string]domain.PostInteractionState, error) {
			assert.Equal(t, []string{"p_1"}, postIDs)
			return map[string]domain.PostInteractionState{"p_1": {Saved: true}}, nil
		},
	}
	interactionSvc := service.NewPostInteractionService(repo, &testutil.MockEventPublisher{}, nil)

	state, err := interactionStatesFrom(context.Background(), interactionSvc, "u_1", "p_1")
	require.NoError(t, err)
	assert.True(t, state.Saved)
}
