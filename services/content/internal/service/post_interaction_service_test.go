package service

import (
	"context"
	"errors"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newInteractionService(t *testing.T, repo *testutil.MockPostInteractionRepository, publisher *testutil.MockEventPublisher, cacheClient *cache.Cache) (*PostInteractionService, *testutil.MockPostInteractionRepository, *testutil.MockEventPublisher) {
	t.Helper()
	if repo == nil {
		repo = &testutil.MockPostInteractionRepository{}
	}
	if publisher == nil {
		publisher = &testutil.MockEventPublisher{}
	}
	return NewPostInteractionService(repo, publisher, cacheClient), repo, publisher
}

func TestRecordViewRecordsAndPublishes(t *testing.T) {
	svc, repo, publisher := newInteractionService(t, nil, nil, nil)

	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"))

	assert.Equal(t, 1, repo.RecordCalls)
	require.Len(t, publisher.Interacted, 1)
	assert.Equal(t, "u_1", publisher.Interacted[0].UserID)
	assert.Equal(t, "p_1", publisher.Interacted[0].PostID)
	assert.Equal(t, domain.PostInteractionView, publisher.Interacted[0].Kind)
}

func TestRecordViewDuplicateDoesNotError(t *testing.T) {
	repo := &testutil.MockPostInteractionRepository{
		RecordFn: func(ctx context.Context, interaction *domain.PostInteraction) (*domain.PostInteraction, error) {
			interaction.ID = "existing"
			return interaction, nil
		},
	}
	svc, _, publisher := newInteractionService(t, repo, nil, nil)

	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"))
	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"), "duplicate views never error the UI")
	assert.Equal(t, 2, repo.RecordCalls)
	assert.Len(t, publisher.Interacted, 2)
}

func TestRecordViewRepoErrorIsReturned(t *testing.T) {
	repo := &testutil.MockPostInteractionRepository{
		RecordFn: func(ctx context.Context, interaction *domain.PostInteraction) (*domain.PostInteraction, error) {
			return nil, errors.New("mongo down")
		},
	}
	svc, _, publisher := newInteractionService(t, repo, nil, nil)

	err := svc.RecordView(context.Background(), "u_1", "p_1")
	require.Error(t, err)
	assert.Empty(t, publisher.Interacted)
}

func TestRecordViewPublishFailureIsSwallowed(t *testing.T) {
	publisher := &testutil.MockEventPublisher{Err: errors.New("kafka down")}
	svc, repo, _ := newInteractionService(t, nil, publisher, nil)

	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"), "a kafka outage must not fail the view")
	assert.Equal(t, 1, repo.RecordCalls)
}

func TestToggleLikeOnAndOff(t *testing.T) {
	svc, repo, publisher := newInteractionService(t, nil, nil, nil)

	liked, err := svc.ToggleLike(context.Background(), "u_1", "p_1")
	require.NoError(t, err)
	assert.True(t, liked, "first toggle likes the post")
	assert.Equal(t, 1, repo.RecordCalls)
	require.Len(t, publisher.Interacted, 1)
	assert.Equal(t, domain.PostInteractionLike, publisher.Interacted[0].Kind)

	repo.FindByUserPostAndKindFn = func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) (*domain.PostInteraction, error) {
		return &domain.PostInteraction{ID: "i_1", UserID: userID, PostID: postID, Kind: kind}, nil
	}

	liked, err = svc.ToggleLike(context.Background(), "u_1", "p_1")
	require.NoError(t, err)
	assert.False(t, liked, "second toggle unlikes the post")
	assert.Equal(t, 1, repo.DeleteCalls)
	assert.Len(t, publisher.Interacted, 1, "removing a like publishes no event")
}

func TestToggleSaveUsesSaveKind(t *testing.T) {
	svc, repo, publisher := newInteractionService(t, nil, nil, nil)

	saved, err := svc.ToggleSave(context.Background(), "u_1", "p_1")
	require.NoError(t, err)
	assert.True(t, saved)
	assert.Equal(t, domain.PostInteractionSave, repo.FindByUserPostKind, "the lookup keys the user's own save")
	assert.Equal(t, "p_1", repo.FindByUserPostID)
	require.Len(t, publisher.Interacted, 1)
	assert.Equal(t, domain.PostInteractionSave, publisher.Interacted[0].Kind)
}

func TestTogglePropagatesRepoErrors(t *testing.T) {
	repo := &testutil.MockPostInteractionRepository{
		FindByUserPostAndKindFn: func(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) (*domain.PostInteraction, error) {
			return nil, errors.New("mongo down")
		},
	}
	svc, _, _ := newInteractionService(t, repo, nil, nil)

	_, err := svc.ToggleLike(context.Background(), "u_1", "p_1")
	require.Error(t, err)
}

func TestRecordViewFirstViewPublishes(t *testing.T) {
	svc, repo, publisher := newInteractionService(t, nil, nil, newMemCache(t))

	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"))

	assert.Equal(t, 1, repo.RecordCalls)
	require.Len(t, publisher.Interacted, 1)
}

func TestRecordViewDuplicateWithin24hIsSkipped(t *testing.T) {
	svc, repo, publisher := newInteractionService(t, nil, nil, newMemCache(t))

	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"))
	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"), "a duplicate view never errors the UI")

	assert.Equal(t, 1, repo.RecordCalls, "the second view must not re-record")
	require.Len(t, publisher.Interacted, 1, "the second view must not publish a second event")
}

func TestRecordViewKeysArePerUserAndPost(t *testing.T) {
	svc, _, publisher := newInteractionService(t, nil, nil, newMemCache(t))

	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"))
	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_2"), "a different post is a fresh view")
	require.NoError(t, svc.RecordView(context.Background(), "u_2", "p_1"), "a different user is a fresh view")

	assert.Len(t, publisher.Interacted, 3)
}

func TestRecordViewRedisDownStillPublishes(t *testing.T) {
	c := newMemCache(t)
	svc, repo, publisher := newInteractionService(t, nil, nil, c)

	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"))

	c.Close()

	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"), "a redis outage must not fail the view")

	assert.Equal(t, 2, repo.RecordCalls, "dedupe fails open: the view is recorded anyway")
	assert.Len(t, publisher.Interacted, 2)
}

func TestToggleLikeUnaffectedBySeenKey(t *testing.T) {
	svc, repo, publisher := newInteractionService(t, nil, nil, newMemCache(t))

	require.NoError(t, svc.RecordView(context.Background(), "u_1", "p_1"), "records the view and claims seen:{u_1}:{p_1}")

	liked, err := svc.ToggleLike(context.Background(), "u_1", "p_1")
	require.NoError(t, err)
	assert.True(t, liked)
	assert.Equal(t, 2, repo.RecordCalls, "the like records unconditionally on top of the view record")
	require.Len(t, publisher.Interacted, 2, "likes publish even when the post was already seen")
	assert.Equal(t, domain.PostInteractionLike, publisher.Interacted[1].Kind)
}
