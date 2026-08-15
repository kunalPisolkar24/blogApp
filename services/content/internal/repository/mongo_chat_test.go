//go:build integration

package repository

import (
	"context"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestChat(userID string) *domain.Chat {
	now := time.Now().UTC()
	return &domain.Chat{
		UserID:    userID,
		Title:     "My Chat",
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func TestChatRepositoryCRUD(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := NewMongoChatRepository(startMongo(t, ctx))

	created, err := repo.Create(ctx, newTestChat("u_1"))
	require.NoError(t, err)
	assert.NotEmpty(t, created.ID)
	assert.Equal(t, "u_1", created.UserID)

	found, err := repo.FindByID(ctx, created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.ID, found.ID)
	assert.Equal(t, "My Chat", found.Title)

	renamed, err := repo.Rename(ctx, created.ID, "Renamed")
	require.NoError(t, err)
	assert.Equal(t, "Renamed", renamed.Title)

	chats, err := repo.ListByUser(ctx, "u_1", 1, 10)
	require.NoError(t, err)
	require.Len(t, chats.Chats, 1)
	assert.Equal(t, created.ID, chats.Chats[0].ID)
	assert.Equal(t, int64(1), chats.TotalChats)
	assert.Equal(t, 1, chats.TotalPages)

	chats, err = repo.ListByUser(ctx, "u_2", 1, 10)
	require.NoError(t, err)
	assert.Empty(t, chats.Chats)
	assert.Zero(t, chats.TotalChats)

	require.NoError(t, repo.Delete(ctx, created.ID))
	_, err = repo.FindByID(ctx, created.ID)
	require.ErrorIs(t, err, domain.ErrNotFound)
}

func TestChatRepositoryNotFound(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := NewMongoChatRepository(startMongo(t, ctx))

	_, err := repo.FindByID(ctx, "nonexistent")
	require.ErrorIs(t, err, domain.ErrNotFound)

	_, err = repo.Rename(ctx, "invalid-id", "x")
	require.ErrorIs(t, err, domain.ErrNotFound)
}

func TestChatRepositoryListByUserPagination(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := NewMongoChatRepository(startMongo(t, ctx))

	now := time.Now().UTC()
	for i := range 3 {
		_, err := repo.Create(ctx, &domain.Chat{
			UserID:    "u_1",
			Title:     "Chat",
			CreatedAt: now.Add(time.Duration(i) * time.Second),
			UpdatedAt: now.Add(time.Duration(i) * time.Second),
		})
		require.NoError(t, err)
	}

	page, err := repo.ListByUser(ctx, "u_1", 2, 2)
	require.NoError(t, err)
	assert.Equal(t, int64(3), page.TotalChats)
	assert.Equal(t, 2, page.TotalPages)
	assert.Equal(t, 2, page.Page)
	require.Len(t, page.Chats, 1, "newest chat is on the first page, so page 2 holds one")

	page, err = repo.ListByUser(ctx, "u_1", 1, 1)
	require.NoError(t, err)
	require.Len(t, page.Chats, 1)
	assert.Equal(t, 3, page.TotalPages)
}

func TestChatRepositoryMessages(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	repo := NewMongoChatRepository(startMongo(t, ctx))

	chat, err := repo.Create(ctx, newTestChat("u_1"))
	require.NoError(t, err)

	now := time.Now().UTC()
	for i := range 3 {
		msg, err := repo.AddMessage(ctx, &domain.ChatMessage{
			ChatID:    chat.ID,
			Role:      domain.ChatMessageRoleUser,
			Content:   "message",
			CreatedAt: now.Add(time.Duration(i) * time.Second),
		})
		require.NoError(t, err)
		assert.NotEmpty(t, msg.ID)
	}

	page, err := repo.Messages(ctx, chat.ID, 1, 2)
	require.NoError(t, err)
	assert.Equal(t, int64(3), page.TotalMessages)
	assert.Equal(t, 2, page.TotalPages)
	require.Len(t, page.Messages, 2)
	assert.Equal(t, "message", page.Messages[0].Content, "newest message first")
}
