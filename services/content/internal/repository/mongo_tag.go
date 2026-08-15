package repository

import (
	"context"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/pagination"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type MongoTagRepository struct {
	collection *mongo.Collection
}

func NewMongoTagRepository(db *mongo.Database) *MongoTagRepository {
	return &MongoTagRepository{
		collection: db.Collection("tags"),
	}
}

// CreateOrFind returns the existing tag or creates it atomically.
func (r *MongoTagRepository) CreateOrFind(ctx context.Context, name string) (*domain.Tag, error) {
	filter := bson.M{"name": name}
	update := bson.M{"$setOnInsert": bson.M{"name": name}}

	opts := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	var tag domain.Tag
	if err := r.collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&tag); err != nil {
		return nil, err
	}
	return &tag, nil
}

func (r *MongoTagRepository) FindAll(ctx context.Context) ([]*domain.Tag, error) {
	opts := options.Find().SetSort(bson.M{"name": 1})

	cursor, err := r.collection.Find(ctx, bson.M{}, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	tags := make([]*domain.Tag, 0)
	if err := cursor.All(ctx, &tags); err != nil {
		return nil, err
	}
	return tags, nil
}

func (r *MongoTagRepository) Search(ctx context.Context, query string, limit int) ([]*domain.Tag, error) {
	filter := bson.M{}
	if query != "" {
		filter = bson.M{"name": bson.M{"$regex": query, "$options": "i"}}
	}

	if limit < 1 {
		limit = pagination.DefaultLimit
	}

	opts := options.Find().
		SetLimit(int64(limit)).
		SetSort(bson.M{"name": 1})

	cursor, err := r.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	tags := make([]*domain.Tag, 0)
	if err := cursor.All(ctx, &tags); err != nil {
		return nil, err
	}
	return tags, nil
}
