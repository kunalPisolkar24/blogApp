//go:build integration

package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/db"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/repository"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"sync/atomic"
)

func startDraftMongo(t *testing.T, ctx context.Context) *mongo.Database {
	t.Helper()

	req := testcontainers.ContainerRequest{
		Image:        "mongo:7.0",
		ExposedPorts: []string{"27017/tcp"},
		WaitingFor:   wait.ForLog("Waiting for connections").WithStartupTimeout(2 * time.Minute),
	}
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	endpoint, err := container.Endpoint(ctx, "")
	require.NoError(t, err)

	client, err := mongo.Connect(ctx, options.Client().ApplyURI("mongodb://"+endpoint))
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Disconnect(context.Background()) })

	database := client.Database("draft_review_test")
	t.Cleanup(func() { _ = database.Drop(context.Background()) })
	return database
}

func newDraftHarness(t *testing.T, ctx context.Context) (*PostDraftService, *mongo.Database) {
	t.Helper()

	database := startDraftMongo(t, ctx)
	require.NoError(t, db.EnsureIndexes(ctx, database))

	postRepo := repository.NewMongoPostRepository(database)
	tagRepo := repository.NewMongoTagRepository(database)
	postService := NewPostService(postRepo, tagRepo, nil, &testutil.MockEventPublisher{}, nil)

	ai := &testutil.MockAIService{
		GenerateDraftFn: func(ctx context.Context, prompt string) (*domain.GeneratedDraft, error) {
			return &domain.GeneratedDraft{
				GeneratedPost: domain.GeneratedPost{
					Title:   "Kafka in Topos",
					Body:    "<h2>Intro</h2><p>Body copy.</p>",
					Summary: "How Kafka moves post events.",
					Tags:    []string{"kafka", "events"},
				},
				ApprovalID: fmt.Sprintf("approval-%d", time.Now().UnixNano()),
			}, nil
		},
		ApprovePostFn: func(ctx context.Context, approvalID string, review *domain.DraftReview) (*domain.GeneratedPost, error) {
			payload := &domain.GeneratedPost{
				Title:   "Kafka in Topos",
				Body:    "<h2>Intro</h2><p>Body copy.</p>",
				Summary: "How Kafka moves post events.",
				Tags:    []string{"kafka", "events"},
			}
			if review != nil && review.Title != nil {
				payload.Title = *review.Title
			}
			return payload, nil
		},
	}
	draftService := NewPostDraftService(
		repository.NewMongoPostDraftRepository(database), ai, postService,
	)
	return draftService, database
}

func countPosts(t *testing.T, database *mongo.Database) int64 {
	t.Helper()
	count, err := database.Collection("posts").CountDocuments(
		context.Background(), bson.M{},
	)
	require.NoError(t, err)
	return count
}

func TestApproveDraftRoundTripOverMongo(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	svc, database := newDraftHarness(t, ctx)

	draft, err := svc.CreateDraft(ctx, "write about kafka events", "author_1")
	require.NoError(t, err)
	assert.Equal(t, domain.DraftStatusPending, draft.Status)

	editedTitle := "Peer edited title"
	approved, err := svc.ApproveDraft(
		ctx, draft.ID, "peer_1", &domain.DraftReview{Title: &editedTitle},
	)
	require.NoError(t, err)
	assert.Equal(t, domain.DraftStatusApproved, approved.Status)
	require.NotEmpty(t, approved.PostID)
	assert.Equal(t, "Peer edited title", approved.Title)

	assert.EqualValues(t, 1, countPosts(t, database), "approval publishes exactly one post")

	var published bson.M
	err = database.Collection("posts").FindOne(
		ctx, bson.M{"_id": toObjectID(t, approved.PostID)},
	).Decode(&published)
	require.NoError(t, err)
	assert.Equal(t, "Peer edited title", published["title"])
	assert.Equal(t, "author_1", published["authorId"])

	// The author cannot act on their own draft.
	secondDraft, err := svc.CreateDraft(ctx, "another one", "author_1")
	require.NoError(t, err)
	_, err = svc.ApproveDraft(ctx, secondDraft.ID, "author_1", nil)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestConcurrentApprovalClaimsPublishOnceOverMongo(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	svc, database := newDraftHarness(t, ctx)

	draft, err := svc.CreateDraft(ctx, "race the claim", "author_1")
	require.NoError(t, err)

	const reviewers = 4
	var successes atomic.Int32
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < reviewers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if _, err := svc.ApproveDraft(ctx, draft.ID, fmt.Sprintf("peer-%d", i), nil); err == nil {
				successes.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()

	assert.EqualValues(t, 1, successes.Load())
	assert.EqualValues(t, 1, countPosts(t, database))
}

func TestWithdrawRemovesPendingDraftFromQueues(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	svc, database := newDraftHarness(t, ctx)
	draftRepo := repository.NewMongoPostDraftRepository(database)

	draft, err := svc.CreateDraft(ctx, "withdraw me", "author_1")
	require.NoError(t, err)

	queue, err := draftRepo.FindPendingExceptAuthor(ctx, "peer_1", 1, 10)
	require.NoError(t, err)
	assert.Len(t, queue.Drafts, 1)

	require.NoError(t, svc.WithdrawDraft(ctx, draft.ID, "author_1"))

	queue, err = draftRepo.FindPendingExceptAuthor(ctx, "peer_1", 1, 10)
	require.NoError(t, err)
	assert.Empty(t, queue.Drafts)
	assert.EqualValues(t, 0, countPosts(t, database))

	_, err = draftRepo.FindByID(ctx, draft.ID)
	assert.True(t, errors.Is(err, domain.ErrNotFound))
}

func toObjectID(t *testing.T, hex string) primitive.ObjectID {
	t.Helper()
	id, err := primitive.ObjectIDFromHex(hex)
	require.NoError(t, err)
	return id
}
