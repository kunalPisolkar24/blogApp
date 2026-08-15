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

type MongoChatRepository struct {
	chats    *mongo.Collection
	messages *mongo.Collection
}

func NewMongoChatRepository(db *mongo.Database) *MongoChatRepository {
	return &MongoChatRepository{
		chats:    db.Collection("chats"),
		messages: db.Collection("messages"),
	}
}

func (r *MongoChatRepository) Create(ctx context.Context, chat *domain.Chat) (*domain.Chat, error) {
	result, err := r.chats.InsertOne(ctx, chat)
	if err != nil {
		return nil, err
	}
	if oid, ok := result.InsertedID.(primitive.ObjectID); ok {
		chat.ID = oid.Hex()
	}
	return chat, nil
}

func (r *MongoChatRepository) FindByID(ctx context.Context, id string) (*domain.Chat, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid id format", domain.ErrNotFound)
	}

	var chat domain.Chat
	err = r.chats.FindOne(ctx, bson.M{"_id": oid}).Decode(&chat)
	if err != nil {
		return nil, wrapNotFound(err)
	}
	return &chat, nil
}

// ListByUser returns the chats of a user, newest first, with the given
// page/limit applied to the total count.
func (r *MongoChatRepository) ListByUser(ctx context.Context, userID string, page, limit int) (*domain.PaginatedChats, error) {
	page, limit = pagination.Normalize(page, limit)
	filter := bson.M{"userId": userID}

	total, err := r.chats.CountDocuments(ctx, filter)
	if err != nil {
		return nil, err
	}

	opts := options.Find().
		SetSkip(int64((page - 1) * limit)).
		SetLimit(int64(limit)).
		SetSort(bson.M{"createdAt": -1})

	cursor, err := r.chats.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	chats := make([]*domain.Chat, 0)
	if err := cursor.All(ctx, &chats); err != nil {
		return nil, err
	}

	return &domain.PaginatedChats{
		Chats:      chats,
		TotalChats: total,
		TotalPages: pages(total, limit),
		Page:       page,
	}, nil
}

func (r *MongoChatRepository) Rename(ctx context.Context, id string, title string) (*domain.Chat, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid id format", domain.ErrNotFound)
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var updated domain.Chat
	err = r.chats.FindOneAndUpdate(ctx, bson.M{"_id": oid}, bson.M{"$set": bson.M{"title": title}}, opts).Decode(&updated)
	if err != nil {
		return nil, wrapNotFound(err)
	}
	return &updated, nil
}

func (r *MongoChatRepository) Delete(ctx context.Context, id string) error {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("%w: invalid id format", domain.ErrNotFound)
	}

	_, err = r.chats.DeleteOne(ctx, bson.M{"_id": oid})
	return err
}

func (r *MongoChatRepository) AddMessage(ctx context.Context, msg *domain.ChatMessage) (*domain.ChatMessage, error) {
	result, err := r.messages.InsertOne(ctx, msg)
	if err != nil {
		return nil, err
	}
	if oid, ok := result.InsertedID.(primitive.ObjectID); ok {
		msg.ID = oid.Hex()
	}
	return msg, nil
}

func (r *MongoChatRepository) DeleteMessage(ctx context.Context, chatID, messageID string) error {
	oid, err := primitive.ObjectIDFromHex(messageID)
	if err != nil {
		return fmt.Errorf("%w: invalid message id format", domain.ErrNotFound)
	}

	_, err = r.messages.DeleteOne(ctx, bson.M{"_id": oid, "chatId": chatID})
	return err
}

// Messages returns the messages of a chat in chronological order, newest
// first, with the given page/limit applied to the total count.
func (r *MongoChatRepository) Messages(ctx context.Context, chatID string, page, limit int) (*domain.PaginatedMessages, error) {
	page, limit = pagination.Normalize(page, limit)
	filter := bson.M{"chatId": chatID}

	total, err := r.messages.CountDocuments(ctx, filter)
	if err != nil {
		return nil, err
	}

	opts := options.Find().
		SetSkip(int64((page - 1) * limit)).
		SetLimit(int64(limit)).
		SetSort(bson.M{"createdAt": -1})

	cursor, err := r.messages.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	msgs := make([]*domain.ChatMessage, 0)
	if err := cursor.All(ctx, &msgs); err != nil {
		return nil, err
	}

	return &domain.PaginatedMessages{
		Messages:      msgs,
		TotalMessages: total,
		TotalPages:    pages(total, limit),
		Page:          page,
	}, nil
}

func pages(total int64, limit int) int {
	pg := int((total + int64(limit) - 1) / int64(limit))
	if pg < 1 {
		return 1
	}
	return pg
}
