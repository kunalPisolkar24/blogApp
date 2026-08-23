//go:build integration

package repository

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/db"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestDraft() *domain.PostDraft {
	return &domain.PostDraft{
		ApprovalID: "approval-" + time.Now().UTC().Format("150405.000000000"),
		Prompt:     "write about mongo",
		Title:      "Generated title",
		Body:       "Generated body",
		Summary:    "Generated summary",
		Tags:       []string{"ai"},
		Status:     domain.DraftStatusPending,
		AuthorID:   "author_1",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}
}

func TestPostDraftRepositoryCRUD(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	database := startMongo(t, ctx)
	require.NoError(t, db.EnsureIndexes(ctx, database))
	repo := NewMongoPostDraftRepository(database)

	draft, err := repo.Create(ctx, newTestDraft())
	require.NoError(t, err)
	assert.NotEmpty(t, draft.ID)

	found, err := repo.FindByID(ctx, draft.ID)
	require.NoError(t, err)
	assert.Equal(t, draft.ApprovalID, found.ApprovalID)
	assert.Equal(t, domain.DraftStatusPending, found.Status)

	// The community queue excludes the author's own drafts.
	page, err := repo.FindPendingExceptAuthor(ctx, "someone-else", 1, 10)
	require.NoError(t, err)
	assert.Len(t, page.Drafts, 1)
	mine, err := repo.FindPendingExceptAuthor(ctx, "author_1", 1, 10)
	require.NoError(t, err)
	assert.Empty(t, mine.Drafts)

	byAuthor, err := repo.FindByAuthor(ctx, "author_1", 1, 10)
	require.NoError(t, err)
	assert.Len(t, byAuthor.Drafts, 1)

	// Withdrawal removes the document entirely.
	require.NoError(t, repo.Delete(ctx, draft.ID))
	_, err = repo.FindByID(ctx, draft.ID)
	assert.True(t, errors.Is(err, domain.ErrNotFound))
}

func TestPostDraftRepositoryTransitionStatusIsAtomic(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	database := startMongo(t, ctx)
	require.NoError(t, db.EnsureIndexes(ctx, database))
	repo := NewMongoPostDraftRepository(database)

	draft, err := repo.Create(ctx, newTestDraft())
	require.NoError(t, err)

	// Five concurrent approvals race to claim the same pending draft:
	// exactly one wins, everyone else conflicts.
	const reviewers = 5
	wins := make(chan struct{}, reviewers)
	var wg sync.WaitGroup
	for i := 0; i < reviewers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := repo.TransitionStatus(
				ctx, draft.ID,
				[]domain.DraftStatus{domain.DraftStatusPending, domain.DraftStatusRejected},
				domain.DraftStatusApproved,
			); err == nil {
				wins <- struct{}{}
			}
		}()
	}
	wg.Wait()
	close(wins)
	assert.Len(t, wins, 1, "exactly one reviewer claims the approval")

	final, err := repo.FindByID(ctx, draft.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.DraftStatusApproved, final.Status)
}

func TestPostDraftRepositoryRejectedThenReapproved(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	database := startMongo(t, ctx)
	require.NoError(t, db.EnsureIndexes(ctx, database))
	repo := NewMongoPostDraftRepository(database)

	draft, err := repo.Create(ctx, newTestDraft())
	require.NoError(t, err)

	rejected, err := repo.TransitionStatus(
		ctx, draft.ID, []domain.DraftStatus{domain.DraftStatusPending}, domain.DraftStatusRejected,
	)
	require.NoError(t, err)
	assert.Equal(t, domain.DraftStatusRejected, rejected.Status)

	// Rejection is soft-terminal: a later approval still goes through.
	approved, err := repo.TransitionStatus(
		ctx, draft.ID,
		[]domain.DraftStatus{domain.DraftStatusPending, domain.DraftStatusRejected},
		domain.DraftStatusApproved,
	)
	require.NoError(t, err)
	assert.Equal(t, domain.DraftStatusApproved, approved.Status)
}
