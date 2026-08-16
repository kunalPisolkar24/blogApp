//go:build integration

package repository

import (
	"context"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/db"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestInteraction(userID, postID string, kind domain.PostInteractionKind) *domain.PostInteraction {
	return &domain.PostInteraction{
		UserID:    userID,
		PostID:    postID,
		Kind:      kind,
		CreatedAt: time.Now().UTC(),
	}
}

func newInteractionRepo(t *testing.T, ctx context.Context) *MongoPostInteractionRepository {
	t.Helper()
	database := startMongo(t, ctx)
	require.NoError(t, db.EnsureIndexes(ctx, database))
	return NewMongoPostInteractionRepository(database)
}

func TestPostInteractionRepositoryRecord(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := newInteractionRepo(t, ctx)

	created, err := repo.Record(ctx, newTestInteraction("u_1", "p_1", domain.PostInteractionLike))
	require.NoError(t, err)
	assert.NotEmpty(t, created.ID)
	assert.Equal(t, "u_1", created.UserID)
	assert.Equal(t, "p_1", created.PostID)
	assert.Equal(t, domain.PostInteractionLike, created.Kind)
}

func TestPostInteractionRepositoryDuplicateIsIdempotent(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := newInteractionRepo(t, ctx)

	first, err := repo.Record(ctx, newTestInteraction("u_1", "p_1", domain.PostInteractionLike))
	require.NoError(t, err)

	second, err := repo.Record(ctx, newTestInteraction("u_1", "p_1", domain.PostInteractionLike))
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID, "duplicate interaction must return the existing record")
}

func TestPostInteractionRepositoryDistinctKinds(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := newInteractionRepo(t, ctx)

	for _, kind := range []domain.PostInteractionKind{
		domain.PostInteractionView,
		domain.PostInteractionLike,
		domain.PostInteractionSave,
	} {
		created, err := repo.Record(ctx, newTestInteraction("u_1", "p_1", kind))
		require.NoError(t, err)
		assert.Equal(t, kind, created.Kind)
	}

	otherUser, err := repo.Record(ctx, newTestInteraction("u_2", "p_1", domain.PostInteractionLike))
	require.NoError(t, err)
	assert.Equal(t, "u_2", otherUser.UserID)

	otherPost, err := repo.Record(ctx, newTestInteraction("u_1", "p_2", domain.PostInteractionLike))
	require.NoError(t, err)
	assert.Equal(t, "p_2", otherPost.PostID)
}

func TestPostInteractionRepositoryFindByIDAndDelete(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := newInteractionRepo(t, ctx)

	created, err := repo.Record(ctx, newTestInteraction("u_1", "p_1", domain.PostInteractionView))
	require.NoError(t, err)

	found, err := repo.FindByID(ctx, created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.ID, found.ID)

	_, err = repo.FindByID(ctx, "507f1f77bcf86cd799439011")
	require.ErrorIs(t, err, domain.ErrNotFound)

	_, err = repo.FindByID(ctx, "invalid-id")
	require.ErrorIs(t, err, domain.ErrNotFound)

	require.NoError(t, repo.Delete(ctx, created.ID))
	_, err = repo.FindByID(ctx, created.ID)
	require.ErrorIs(t, err, domain.ErrNotFound)
}

func TestPostInteractionRepositoryFindByUserPostAndKind(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := newInteractionRepo(t, ctx)

	created, err := repo.Record(ctx, newTestInteraction("u_1", "p_1", domain.PostInteractionLike))
	require.NoError(t, err)

	found, err := repo.FindByUserPostAndKind(ctx, "u_1", "p_1", domain.PostInteractionLike)
	require.NoError(t, err)
	assert.Equal(t, created.ID, found.ID)

	_, err = repo.FindByUserPostAndKind(ctx, "u_1", "p_1", domain.PostInteractionSave)
	require.ErrorIs(t, err, domain.ErrNotFound, "a different kind is not the same interaction")

	_, err = repo.FindByUserPostAndKind(ctx, "u_2", "p_1", domain.PostInteractionLike)
	require.ErrorIs(t, err, domain.ErrNotFound, "another user's interaction is not ours")
}

func TestPostInteractionRepositoryListByUser(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := newInteractionRepo(t, ctx)

	base := time.Now().UTC()
	for _, interaction := range []*domain.PostInteraction{
		{UserID: "u_1", PostID: "p_1", Kind: domain.PostInteractionView, CreatedAt: base},
		{UserID: "u_1", PostID: "p_2", Kind: domain.PostInteractionView, CreatedAt: base.Add(time.Minute)},
		{UserID: "u_1", PostID: "p_3", Kind: domain.PostInteractionLike, CreatedAt: base.Add(2 * time.Minute)},
		{UserID: "u_2", PostID: "p_1", Kind: domain.PostInteractionLike, CreatedAt: base.Add(3 * time.Minute)},
	} {
		created, err := repo.Record(ctx, interaction)
		require.NoError(t, err)
		assert.NotEmpty(t, created.ID)
	}

	page, err := repo.ListByUser(ctx, "u_1", 1, 2)
	require.NoError(t, err)
	assert.Equal(t, int64(3), page.TotalInteractions)
	assert.Equal(t, 2, page.TotalPages)
	assert.Equal(t, 1, page.Page)
	require.Len(t, page.Interactions, 2)
	assert.Equal(t, "p_3", page.Interactions[0].PostID, "newest interaction first")
	assert.Equal(t, "p_2", page.Interactions[1].PostID)

	page, err = repo.ListByUser(ctx, "u_1", 2, 2)
	require.NoError(t, err)
	require.Len(t, page.Interactions, 1)
	assert.Equal(t, "p_1", page.Interactions[0].PostID)

	page, err = repo.ListByUser(ctx, "u_2", 1, 10)
	require.NoError(t, err)
	require.Len(t, page.Interactions, 1)
	assert.Equal(t, int64(1), page.TotalInteractions)

	page, err = repo.ListByUser(ctx, "nobody", 1, 10)
	require.NoError(t, err)
	assert.Empty(t, page.Interactions)
	assert.Zero(t, page.TotalInteractions)
}

func TestPostInteractionRepositoryListStates(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := newInteractionRepo(t, ctx)

	for _, interaction := range []*domain.PostInteraction{
		{UserID: "u_1", PostID: "p_1", Kind: domain.PostInteractionLike, CreatedAt: time.Now().UTC()},
		{UserID: "u_1", PostID: "p_2", Kind: domain.PostInteractionSave, CreatedAt: time.Now().UTC()},
		{UserID: "u_1", PostID: "p_2", Kind: domain.PostInteractionLike, CreatedAt: time.Now().UTC()},
		{UserID: "u_1", PostID: "p_3", Kind: domain.PostInteractionView, CreatedAt: time.Now().UTC()},
		{UserID: "u_2", PostID: "p_1", Kind: domain.PostInteractionLike, CreatedAt: time.Now().UTC()},
	} {
		_, err := repo.Record(ctx, interaction)
		require.NoError(t, err)
	}

	states, err := repo.ListStates(ctx, "u_1", []string{"p_1", "p_2", "p_3", "p_missing"})
	require.NoError(t, err)
	assert.Equal(t, domain.PostInteractionState{Liked: true}, states["p_1"], "liked posts surface Liked")
	assert.Equal(t, domain.PostInteractionState{Liked: true, Saved: true}, states["p_2"], "a post can be liked and saved at once")
	assert.Equal(t, domain.PostInteractionState{}, states["p_3"], "views do not count as like or save")
	assert.Zero(t, states["p_missing"], "posts the user never interacted with have no entry")

	otherStates, err := repo.ListStates(ctx, "u_2", []string{"p_1"})
	require.NoError(t, err)
	assert.Equal(t, domain.PostInteractionState{Liked: true}, otherStates["p_1"], "states are scoped to the requesting user")
}

func TestPostInteractionRepositoryListStatesEmptyAndNoPosts(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := newInteractionRepo(t, ctx)

	states, err := repo.ListStates(ctx, "nobody", []string{"p_1"})
	require.NoError(t, err)
	assert.Empty(t, states)

	states, err = repo.ListStates(ctx, "nobody", nil)
	require.NoError(t, err)
	assert.Empty(t, states, "no post ids is a no-op, not an error")
}
