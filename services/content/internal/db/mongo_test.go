//go:build integration

package db

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

func startMongoContainer(t *testing.T, ctx context.Context) string {
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
	return "mongodb://" + endpoint + "/content_test"
}

func testMongoClient(t *testing.T, ctx context.Context) (*mongo.Client, *mongo.Database) {
	t.Helper()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(startMongoContainer(t, ctx)))
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Disconnect(context.Background()) })

	database := client.Database("content_test")
	t.Cleanup(func() { _ = database.Drop(context.Background()) })
	return client, database
}

func TestConnectAndPing(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client, _ := testMongoClient(t, ctx)
	require.NoError(t, client.Ping(ctx, readpref.Primary()))
}

func TestEnsureIndexes(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	_, database := testMongoClient(t, ctx)
	require.NoError(t, EnsureIndexes(ctx, database))

	indexNames := listIndexes(t, ctx, database.Collection("posts").Indexes())
	for _, name := range []string{"_id_", "slug_unique", "authorId_createdAt", "tags_createdAt", "createdAt_desc"} {
		assert.Contains(t, indexNames, name)
	}

	tagNames := listIndexes(t, ctx, database.Collection("tags").Indexes())
	assert.Contains(t, tagNames, "name_unique")
}

func TestIsCollectionShardedFalseOnStandalone(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	_, database := testMongoClient(t, ctx)

	sharded, err := isCollectionSharded(ctx, database, "posts")
	require.NoError(t, err)
	assert.False(t, sharded, "a standalone mongod must be treated as unsharded so the unique slug index is created")
}

func TestUniqueSlugIndexRejectsDuplicates(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	_, database := testMongoClient(t, ctx)
	require.NoError(t, EnsureIndexes(ctx, database))

	posts := database.Collection("posts")
	_, err := posts.InsertOne(ctx, bson.M{"slug": "same-slug", "title": "one"})
	require.NoError(t, err)

	_, err = posts.InsertOne(ctx, bson.M{"slug": "same-slug", "title": "two"})
	require.Error(t, err, "the unique slug index must reject a second post with the same slug")
}

func listIndexes(t *testing.T, ctx context.Context, view mongo.IndexView) []string {
	t.Helper()

	cursor, err := view.List(ctx)
	require.NoError(t, err)

	var names []string
	for cursor.Next(ctx) {
		var doc struct {
			Name string `bson:"name"`
		}
		require.NoError(t, cursor.Decode(&doc))
		names = append(names, doc.Name)
	}
	return names
}
