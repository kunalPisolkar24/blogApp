package repository

import (
	"context"
	"fmt"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/pagination"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type MongoPostInteractionRepository struct {
	collection *mongo.Collection
}

func NewMongoPostInteractionRepository(db *mongo.Database) *MongoPostInteractionRepository {
	return &MongoPostInteractionRepository{
		collection: db.Collection("post_interactions"),
	}
}

// Record registers an interaction. The (userId, postId, kind) unique
// index makes it idempotent: a duplicate view, like or save returns the
// existing record instead of inserting a new one.
func (r *MongoPostInteractionRepository) Record(ctx context.Context, interaction *domain.PostInteraction) (*domain.PostInteraction, error) {
	filter := bson.M{
		"userId": interaction.UserID,
		"postId": interaction.PostID,
		"kind":   interaction.Kind,
	}
	update := bson.M{"$setOnInsert": bson.M{
		"userId":    interaction.UserID,
		"postId":    interaction.PostID,
		"kind":      interaction.Kind,
		"createdAt": interaction.CreatedAt,
	}}

	opts := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	var result domain.PostInteraction
	if err := r.collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *MongoPostInteractionRepository) FindByID(ctx context.Context, id string) (*domain.PostInteraction, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid id format", domain.ErrNotFound)
	}

	var interaction domain.PostInteraction
	err = r.collection.FindOne(ctx, bson.M{"_id": oid}).Decode(&interaction)
	if err != nil {
		return nil, wrapNotFound(err)
	}
	return &interaction, nil
}

// FindByUserPostAndKind returns the interaction of a user with a post,
// or domain.ErrNotFound when the user has not interacted that way.
func (r *MongoPostInteractionRepository) FindByUserPostAndKind(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) (*domain.PostInteraction, error) {
	var interaction domain.PostInteraction
	err := r.collection.FindOne(ctx, bson.M{"userId": userID, "postId": postID, "kind": kind}).Decode(&interaction)
	if err != nil {
		return nil, wrapNotFound(err)
	}
	return &interaction, nil
}

// ListByUser returns the interactions of a user, newest first, with the
// given page/limit applied to the total count.
func (r *MongoPostInteractionRepository) ListByUser(ctx context.Context, userID string, page, limit int) (*domain.PaginatedPostInteractions, error) {
	page, limit = pagination.Normalize(page, limit)
	filter := bson.M{"userId": userID}

	total, err := r.collection.CountDocuments(ctx, filter)
	if err != nil {
		return nil, err
	}

	opts := options.Find().
		SetSkip(int64((page - 1) * limit)).
		SetLimit(int64(limit)).
		SetSort(bson.M{"createdAt": -1})

	cursor, err := r.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	interactions := make([]*domain.PostInteraction, 0)
	if err := cursor.All(ctx, &interactions); err != nil {
		return nil, err
	}

	return &domain.PaginatedPostInteractions{
		Interactions:      interactions,
		TotalInteractions: total,
		TotalPages:        pages(total, limit),
		Page:              page,
	}, nil
}

func (r *MongoPostInteractionRepository) Delete(ctx context.Context, id string) error {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("%w: invalid id format", domain.ErrNotFound)
	}

	_, err = r.collection.DeleteOne(ctx, bson.M{"_id": oid})
	return err
}

// ListStates returns the like/save state of a user for every given
// post in one query. Posts the user never interacted with are absent
// from the map, so callers can treat a missing post as fully unmarked.
func (r *MongoPostInteractionRepository) ListStates(ctx context.Context, userID string, postIDs []string) (map[string]domain.PostInteractionState, error) {
	if len(postIDs) == 0 {
		return map[string]domain.PostInteractionState{}, nil
	}

	filter := bson.M{
		"userId": userID,
		"postId": bson.M{"$in": postIDs},
	}
	cursor, err := r.collection.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	interactions := make([]domain.PostInteraction, 0)
	if err := cursor.All(ctx, &interactions); err != nil {
		return nil, err
	}

	states := make(map[string]domain.PostInteractionState, len(interactions))
	for _, interaction := range interactions {
		state := states[interaction.PostID]
		switch interaction.Kind {
		case domain.PostInteractionLike:
			state.Liked = true
		case domain.PostInteractionSave:
			state.Saved = true
		}
		states[interaction.PostID] = state
	}
	return states, nil
}
