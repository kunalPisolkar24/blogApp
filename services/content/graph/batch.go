package graph

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
)

// batchSettle is how long a batcher waits for more ids before running
// the batch operation: callers arriving within the window share one
// underlying call instead of each running their own.
const batchSettle = 5 * time.Millisecond

// batchCall is a single id's pending result; waiters block on done.
type batchCall[T any] struct {
	done  chan struct{}
	value T
	err   error
}

// batcher coalesces concurrent lookups for many ids into one batch
// operation. Ids registered within a short settle window share a single
// flush; results are fanned out to every waiter. This turns N+1 access
// patterns (related posts per post, federation entities one at a time)
// into one call per request.
type batcher[T any] struct {
	ctx     context.Context
	settle  time.Duration
	batchFn func(ctx context.Context, ids []string) (map[string]T, map[string]error)

	mu      sync.Mutex
	pending map[string]*batchCall[T]
	timer   *time.Timer
}

func newBatcher[T any](ctx context.Context, batchFn func(context.Context, []string) (map[string]T, map[string]error)) *batcher[T] {
	return &batcher[T]{
		ctx:     ctx,
		settle:  batchSettle,
		batchFn: batchFn,
		pending: make(map[string]*batchCall[T]),
	}
}

// get registers id and waits for the shared batch result.
func (b *batcher[T]) get(ctx context.Context, id string) (T, error) {
	b.mu.Lock()
	if call, ok := b.pending[id]; ok {
		b.mu.Unlock()
		return waitFor(ctx, call)
	}

	call := &batchCall[T]{done: make(chan struct{})}
	b.pending[id] = call
	if b.timer == nil {
		b.timer = time.AfterFunc(b.settle, b.flush)
	}
	b.mu.Unlock()

	return waitFor(ctx, call)
}

func waitFor[T any](ctx context.Context, call *batchCall[T]) (T, error) {
	select {
	case <-call.done:
		return call.value, call.err
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	}
}

// flush runs the batch operation for every id registered in the last
// window, fans the results out, and arms the next round if more ids
// arrived while it was running.
func (b *batcher[T]) flush() {
	b.mu.Lock()
	if len(b.pending) == 0 {
		b.timer = nil
		b.mu.Unlock()
		return
	}
	calls := b.pending
	b.pending = make(map[string]*batchCall[T])
	b.timer = nil
	b.mu.Unlock()

	ids := make([]string, 0, len(calls))
	for id := range calls {
		ids = append(ids, id)
	}

	results, idErrs := b.batchFn(b.ctx, ids)

	b.mu.Lock()
	for id, call := range calls {
		call.value = results[id]
		call.err = idErrs[id]
		close(call.done)
	}
	if len(b.pending) > 0 {
		b.timer = time.AfterFunc(b.settle, b.flush)
	}
	b.mu.Unlock()
}

// batchRegistry holds one batcher per related-posts limit plus a single
// entity batcher, shared by every resolver of one request. It is
// injected per request by WithBatching.
type batchRegistry struct {
	mu       sync.Mutex
	svc      *service.PostService
	related  map[int]*batcher[[]*domain.Post]
	entities *batcher[*domain.Post]
}

type batchRegistryKey struct{}

func registryFrom(ctx context.Context) *batchRegistry {
	reg, _ := ctx.Value(batchRegistryKey{}).(*batchRegistry)
	return reg
}

func (r *batchRegistry) relatedBatcher(limit int) *batcher[[]*domain.Post] {
	r.mu.Lock()
	defer r.mu.Unlock()
	if b, ok := r.related[limit]; ok {
		return b
	}
	b := newBatcher(context.Background(), func(ctx context.Context, postIDs []string) (map[string][]*domain.Post, map[string]error) {
		results, err := r.svc.RelatedPostsBatch(ctx, postIDs, limit)
		if err != nil {
			idErrs := make(map[string]error, len(postIDs))
			for _, postID := range postIDs {
				idErrs[postID] = err
			}
			return nil, idErrs
		}
		return results, nil
	})
	r.related[limit] = b
	return b
}

func (r *batchRegistry) entityBatcher() *batcher[*domain.Post] {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.entities != nil {
		return r.entities
	}
	b := newBatcher(context.Background(), func(ctx context.Context, ids []string) (map[string]*domain.Post, map[string]error) {
		posts, err := r.svc.GetPostsByIDs(ctx, ids)
		if err != nil {
			idErrs := make(map[string]error, len(ids))
			for _, id := range ids {
				idErrs[id] = err
			}
			return nil, idErrs
		}

		results := make(map[string]*domain.Post, len(posts))
		for _, post := range posts {
			results[post.ID] = post
		}
		idErrs := make(map[string]error)
		for _, id := range ids {
			if results[id] == nil {
				idErrs[id] = domain.ErrNotFound
			}
		}
		return results, idErrs
	})
	r.entities = b
	return b
}

// WithBatching injects a per-request batch registry so related-posts
// and federation entity lookups share one underlying call per request
// instead of firing one AI RPC or Mongo query per object.
func WithBatching(svc *service.PostService, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reg := &batchRegistry{
			svc:     svc,
			related: make(map[int]*batcher[[]*domain.Post]),
		}
		ctx := context.WithValue(r.Context(), batchRegistryKey{}, reg)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// relatedPostsFrom resolves related posts for one post, sharing a
// single AI call and hydration pass with every other resolver of the
// same request when batching is enabled.
func relatedPostsFrom(ctx context.Context, svc *service.PostService, postID string, limit int) ([]*domain.Post, error) {
	if reg := registryFrom(ctx); reg != nil {
		return reg.relatedBatcher(limit).get(ctx, postID)
	}
	return svc.RelatedPosts(ctx, postID, limit)
}

// postByIDFrom resolves a post by id, sharing one repository call
// across every federation entity of the same request when batching is
// enabled.
func postByIDFrom(ctx context.Context, svc *service.PostService, id string) (*domain.Post, error) {
	if reg := registryFrom(ctx); reg != nil {
		return reg.entityBatcher().get(ctx, id)
	}
	return svc.GetPost(ctx, id)
}
