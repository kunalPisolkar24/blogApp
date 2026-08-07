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
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func startMongo(t *testing.T, ctx context.Context) *mongo.Database {
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

	database := client.Database("content_test")
	t.Cleanup(func() { _ = database.Drop(context.Background()) })
	return database
}

func newTestPost() *domain.Post {
	return &domain.Post{
		Title:     "Hello World",
		Body:      "A body",
		Slug:      "hello-world",
		AuthorID:  "u_1",
		Tags:      []string{"go"},
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
}

func TestPostRepositoryCRUD(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := NewMongoPostRepository(startMongo(t, ctx))

	created, err := repo.Create(ctx, newTestPost())
	require.NoError(t, err)
	assert.NotEmpty(t, created.ID)
	assert.Equal(t, "hello-world", created.Slug)

	found, err := repo.FindByID(ctx, created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.ID, found.ID)
	assert.Equal(t, "Hello World", found.Title)

	updated, err := repo.Update(ctx, created.ID, &domain.Post{Title: "Changed", Tags: []string{"go", "web"}})
	require.NoError(t, err)
	assert.Equal(t, "Changed", updated.Title)

	all, err := repo.FindAll(ctx, 1, 10)
	require.NoError(t, err)
	require.Len(t, all.Posts, 1)
	assert.Equal(t, created.ID, all.Posts[0].ID)
	assert.Equal(t, 1, all.Page)

	byAuthor, err := repo.FindByAuthor(ctx, "u_1", 1, 10)
	require.NoError(t, err)
	require.Len(t, byAuthor.Posts, 1)

	byTag, err := repo.FindByTag(ctx, "go", 1, 10)
	require.NoError(t, err)
	require.Len(t, byTag.Posts, 1)

	require.NoError(t, repo.UpdateSummary(ctx, created.ID, "A summary", domain.PostStatusCompleted))
	after, err := repo.FindByID(ctx, created.ID)
	require.NoError(t, err)
	assert.Equal(t, "A summary", after.Summary)
	assert.Equal(t, domain.PostStatusCompleted, after.SummaryStatus)

	require.NoError(t, repo.Delete(ctx, created.ID))
	_, err = repo.FindByID(ctx, created.ID)
	require.ErrorIs(t, err, domain.ErrNotFound)
}

func TestPostRepositoryFindByIDs(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := NewMongoPostRepository(startMongo(t, ctx))

	first, err := repo.Create(ctx, newTestPost())
	require.NoError(t, err)
	second, err := repo.Create(ctx, &domain.Post{
		Title:    "Second",
		Body:     "Another body",
		Slug:     "second",
		AuthorID: "u_2",
	})
	require.NoError(t, err)

	posts, err := repo.FindByIDs(ctx, []string{second.ID, "not-a-valid-objectid", first.ID, "nonexistent"})
	require.NoError(t, err)
	require.Len(t, posts, 2)

	ids := map[string]bool{}
	for _, p := range posts {
		ids[p.ID] = true
	}
	assert.True(t, ids[first.ID], "existing posts are returned")
	assert.True(t, ids[second.ID], "existing posts are returned")
}

func TestPostRepositoryDuplicateSlug(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	database := startMongo(t, ctx)
	require.NoError(t, db.EnsureIndexes(ctx, database))

	repo := NewMongoPostRepository(database)

	first, err := repo.Create(ctx, newTestPost())
	require.NoError(t, err)
	require.NotEmpty(t, first.ID)

	_, err = repo.Create(ctx, &domain.Post{Title: "Another", Slug: "hello-world", AuthorID: "u_2"})
	require.Error(t, err)
	require.Contains(t, err.Error(), "duplicate key")
}

func TestPostRepositoryPagination(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := NewMongoPostRepository(startMongo(t, ctx))

	for range 3 {
		_, err := repo.Create(ctx, &domain.Post{Title: "Post", Slug: "post", AuthorID: "u_1"})
		require.NoError(t, err)
	}

	page, err := repo.FindAll(ctx, 1, 2)
	require.NoError(t, err)
	assert.Equal(t, int64(3), page.TotalPosts)
	require.Len(t, page.Posts, 2, "expected 2 posts on page 1")
	assert.Equal(t, 1, page.Page)
	assert.Equal(t, 2, page.TotalPages)
}

func TestTagRepository(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := NewMongoTagRepository(startMongo(t, ctx))

	tag, err := repo.CreateOrFind(ctx, "golang")
	require.NoError(t, err)
	assert.Equal(t, "golang", tag.Name)
	assert.NotEmpty(t, tag.ID)

	again, err := repo.CreateOrFind(ctx, "golang")
	require.NoError(t, err)
	assert.Equal(t, tag.ID, again.ID, "existing tag must be reused")

	tags, err := repo.FindAll(ctx)
	require.NoError(t, err)
	require.Len(t, tags, 1)

	results, err := repo.Search(ctx, "gol", 10)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "golang", results[0].Name)
}
