package repository

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/pagination"
)

type MongoPostDraftRepository struct {
	collection *mongo.Collection
}

func NewMongoPostDraftRepository(db *mongo.Database) *MongoPostDraftRepository {
	return &MongoPostDraftRepository{collection: db.Collection("post_drafts")}
}

func (r *MongoPostDraftRepository) Create(ctx context.Context, draft *domain.PostDraft) (*domain.PostDraft, error) {
	result, err := r.collection.InsertOne(ctx, draft)
	if err != nil {
		return nil, err
	}
	draft.ID = result.InsertedID.(primitive.ObjectID).Hex()
	return draft, nil
}

func (r *MongoPostDraftRepository) FindByID(ctx context.Context, id string) (*domain.PostDraft, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid id format", domain.ErrNotFound)
	}

	var draft domain.PostDraft
	err = r.collection.FindOne(ctx, bson.M{"_id": oid}).Decode(&draft)
	if err != nil {
		return nil, wrapNotFound(err)
	}
	return &draft, nil
}

func (r *MongoPostDraftRepository) FindPendingExceptAuthor(
	ctx context.Context, authorID string, page, limit int,
) (*domain.PaginatedPostDrafts, error) {
	filter := bson.M{"status": domain.DraftStatusPending, "authorId": bson.M{"$ne": authorID}}
	return r.findWithPagination(ctx, filter, page, limit)
}

func (r *MongoPostDraftRepository) FindByAuthor(
	ctx context.Context, authorID string, page, limit int,
) (*domain.PaginatedPostDrafts, error) {
	return r.findWithPagination(ctx, bson.M{"authorId": authorID}, page, limit)
}

// TransitionStatus claims a status move with FindOneAndUpdate so two
// concurrent reviewers cannot both win: only the first document still
// matching one of the from statuses transitions; everyone else gets
// ErrConflict.
func (r *MongoPostDraftRepository) TransitionStatus(
	ctx context.Context, id string, from []domain.DraftStatus, to domain.DraftStatus,
) (*domain.PostDraft, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid id format", domain.ErrNotFound)
	}

	fromAny := make([]any, len(from))
	for i, status := range from {
		fromAny[i] = status
	}
	update := bson.M{
		"$set": bson.M{"status": to, "updatedAt": time.Now()},
	}
	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)

	var draft domain.PostDraft
	err = r.collection.FindOneAndUpdate(
		ctx,
		bson.M{"_id": oid, "status": bson.M{"$in": fromAny}},
		update,
		opts,
	).Decode(&draft)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, fmt.Errorf("%w: draft already reviewed", domain.ErrConflict)
	}
	if err != nil {
		return nil, wrapNotFound(err)
	}
	return &draft, nil
}

func (r *MongoPostDraftRepository) Update(ctx context.Context, draft *domain.PostDraft) (*domain.PostDraft, error) {
	oid, err := primitive.ObjectIDFromHex(draft.ID)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid id format", domain.ErrNotFound)
	}

	draft.UpdatedAt = time.Now()
	update := bson.M{"$set": bson.M{
		"title":     draft.Title,
		"body":      draft.Body,
		"summary":   draft.Summary,
		"tags":      draft.Tags,
		"status":    draft.Status,
		"postId":    draft.PostID,
		"updatedAt": draft.UpdatedAt,
	}}
	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)

	var updated domain.PostDraft
	if err := r.collection.FindOneAndUpdate(ctx, bson.M{"_id": oid}, update, opts).Decode(&updated); err != nil {
		return nil, wrapNotFound(err)
	}
	return &updated, nil
}

func (r *MongoPostDraftRepository) Delete(ctx context.Context, id string) error {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("%w: invalid id format", domain.ErrNotFound)
	}
	_, err = r.collection.DeleteOne(ctx, bson.M{"_id": oid})
	return err
}

func (r *MongoPostDraftRepository) findWithPagination(
	ctx context.Context, filter bson.M, page, limit int,
) (*domain.PaginatedPostDrafts, error) {
	page, limit = pagination.Normalize(page, limit)

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

	drafts := make([]*domain.PostDraft, 0)
	if err := cursor.All(ctx, &drafts); err != nil {
		return nil, err
	}

	return &domain.PaginatedPostDrafts{
		Drafts:      drafts,
		TotalPages:  int(math.Ceil(float64(total) / float64(limit))),
		TotalDrafts: total,
		Page:        page,
	}, nil
}
