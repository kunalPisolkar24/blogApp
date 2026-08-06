package db

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const indexTimeout = 30 * time.Second

// EnsureIndexes creates the indexes required by the posts and tags collections.
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
		{
			Keys:    bson.D{{Key: "slug", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("slug_unique"),
		},
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

	return nil
}
