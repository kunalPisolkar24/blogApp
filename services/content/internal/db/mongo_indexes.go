package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const indexTimeout = 30 * time.Second

// EnsureIndexes creates the indexes required by the posts, tags, chats,
// messages and post_interactions collections.
//
// The unique slug index is created only on unsharded collections: a
// unique index must start with the shard key on a sharded collection,
// and posts is sharded on a hashed _id key (see infra/scripts/shard-init.sh),
// so a {slug: 1} unique index is not allowed there. Slug uniqueness in
// the sharded setup is enforced in-app (PostService.ensureSlugAvailable).
func EnsureIndexes(ctx context.Context, db *mongo.Database) error {
	ctx, cancel := context.WithTimeout(ctx, indexTimeout)
	defer cancel()

	postIndexes := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "authorId", Value: 1}, {Key: "createdAt", Value: -1}},
			Options: options.Index().SetName("authorId_createdAt"),
		},
		{
			Keys:    bson.D{{Key: "tags", Value: 1}, {Key: "createdAt", Value: -1}},
			Options: options.Index().SetName("tags_createdAt"),
		},
		{
			Keys:    bson.D{{Key: "createdAt", Value: -1}},
			Options: options.Index().SetName("createdAt_desc"),
		},
	}

	sharded, err := isCollectionSharded(ctx, db, "posts")
	if err != nil {
		return fmt.Errorf("check posts shard status: %w", err)
	}
	if !sharded {
		postIndexes = append(postIndexes, mongo.IndexModel{
			Keys:    bson.D{{Key: "slug", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("slug_unique"),
		})
	}

	if _, err := db.Collection("posts").Indexes().CreateMany(ctx, postIndexes); err != nil {
		return fmt.Errorf("create posts indexes: %w", err)
	}

	tagIndexes := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "name", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("name_unique"),
		},
	}

	if _, err := db.Collection("tags").Indexes().CreateMany(ctx, tagIndexes); err != nil {
		return fmt.Errorf("create tags indexes: %w", err)
	}

	chatIndexes := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "userId", Value: 1}, {Key: "createdAt", Value: -1}},
			Options: options.Index().SetName("userId_createdAt"),
		},
	}

	if _, err := db.Collection("chats").Indexes().CreateMany(ctx, chatIndexes); err != nil {
		return fmt.Errorf("create chats indexes: %w", err)
	}

	messageIndexes := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "chatId", Value: 1}, {Key: "createdAt", Value: -1}},
			Options: options.Index().SetName("chatId_createdAt"),
		},
	}

	if _, err := db.Collection("messages").Indexes().CreateMany(ctx, messageIndexes); err != nil {
		return fmt.Errorf("create messages indexes: %w", err)
	}

	interactionIndexes := []mongo.IndexModel{
		{
			// Idempotent likes/saves: a duplicate (userId, postId, kind)
			// is rejected by Mongo and returns the existing record.
			Keys:    bson.D{{Key: "userId", Value: 1}, {Key: "postId", Value: 1}, {Key: "kind", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("userId_postId_kind_unique"),
		},
		{
			Keys:    bson.D{{Key: "userId", Value: 1}, {Key: "createdAt", Value: -1}},
			Options: options.Index().SetName("userId_createdAt"),
		},
	}

	if _, err := db.Collection("post_interactions").Indexes().CreateMany(ctx, interactionIndexes); err != nil {
		return fmt.Errorf("create post_interactions indexes: %w", err)
	}

	return nil
}

// isCollectionSharded reports whether the collection is sharded, by
// looking up its metadata in config.collections. Standalone mongod and
// unsharded collections have no entry (or no shardKey), so they report
// false and keep their unique slug index.
func isCollectionSharded(ctx context.Context, db *mongo.Database, collection string) (bool, error) {
	var entry struct {
		ShardKey bson.M `bson:"shardKey"`
	}
	err := db.Client().Database("config").Collection("collections").
		FindOne(ctx, bson.M{"_id": db.Name() + "." + collection}).Decode(&entry)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return entry.ShardKey != nil, nil
}
