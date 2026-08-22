package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newChatService(t *testing.T, repo *testutil.MockChatRepository, ai *testutil.MockAIService) *ChatService {
	t.Helper()

	if repo == nil {
		repo = &testutil.MockChatRepository{UserID: "u_1"}
	}
	if ai == nil {
		ai = &testutil.MockAIService{}
	}
	s := NewChatService(repo, ai)
	s.clock = func() time.Time { return time.Date(2026, 8, 8, 12, 0, 0, 0, time.UTC) }
	return s
}

func TestCreateChat(t *testing.T) {
	s := newChatService(t, nil, nil)

	chat, err := s.CreateChat(context.Background(), "u_1", "  My Chat  ")

	require.NoError(t, err)
	assert.Equal(t, "u_1", chat.UserID)
	assert.Equal(t, "My Chat", chat.Title)
	assert.False(t, chat.CreatedAt.IsZero())
}

func TestCreateChatDefaultsTitle(t *testing.T) {
	s := newChatService(t, nil, nil)

	chat, err := s.CreateChat(context.Background(), "u_1", "   ")

	require.NoError(t, err)
	assert.Equal(t, "New Chat", chat.Title)
}

func TestGetChatOwnership(t *testing.T) {
	repo := &testutil.MockChatRepository{
		UserID: "u_1",
		FindByIDFn: func(ctx context.Context, id string) (*domain.Chat, error) {
			return &domain.Chat{ID: id, UserID: "u_2"}, nil
		},
	}
	s := newChatService(t, repo, nil)

	_, err := s.GetChat(context.Background(), "c_1", "u_1")

	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestListChatsPassesPaginationThrough(t *testing.T) {
	repo := &testutil.MockChatRepository{
		ListByUserFn: func(ctx context.Context, userID string, page, limit int) (*domain.PaginatedChats, error) {
			assert.Equal(t, "u_1", userID)
			assert.Equal(t, 3, page)
			assert.Equal(t, 5, limit)
			return &domain.PaginatedChats{
				Chats:      []*domain.Chat{{ID: "c_1", UserID: "u_1"}},
				TotalChats: 11,
				TotalPages: 3,
				Page:       page,
			}, nil
		},
	}
	s := newChatService(t, repo, nil)

	result, err := s.ListChats(context.Background(), "u_1", 3, 5)

	require.NoError(t, err)
	assert.Len(t, result.Chats, 1)
	assert.Equal(t, int64(11), result.TotalChats)
	assert.Equal(t, 3, result.TotalPages)
}

func TestRenameChatEmptyTitle(t *testing.T) {
	s := newChatService(t, nil, nil)

	_, err := s.RenameChat(context.Background(), "c_1", "u_1", "   ")

	assert.Error(t, err)
}

func TestDeleteChatForbidden(t *testing.T) {
	repo := &testutil.MockChatRepository{
		UserID: "u_2",
		FindByIDFn: func(ctx context.Context, id string) (*domain.Chat, error) {
			return &domain.Chat{ID: id, UserID: "u_1"}, nil
		},
	}
	s := newChatService(t, repo, nil)

	err := s.DeleteChat(context.Background(), "c_1", "u_2")

	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestAskChatPersistsBothMessages(t *testing.T) {
	ai := &testutil.MockAIService{
		ChatAnswerFn: func(ctx context.Context, threadID, query string, history []domain.ChatTurn, topK int) (*domain.ChatAnswer, error) {
			assert.Equal(t, "what is topos?", query)
			assert.Equal(t, 5, topK)
			return &domain.ChatAnswer{Content: "Topos is a blog platform.", CitedPostIDs: []string{"p_1"}}, nil
		},
	}
	var added []*domain.ChatMessage
	repo := &testutil.MockChatRepository{
		UserID: "u_1",
		AddMessageFn: func(ctx context.Context, msg *domain.ChatMessage) (*domain.ChatMessage, error) {
			added = append(added, msg)
			msg.ID = "m_" + string(msg.Role)
			return msg, nil
		},
	}
	s := newChatService(t, repo, ai)

	msg, err := s.AskChat(context.Background(), "c_1", "u_1", "what is topos?")

	require.NoError(t, err)
	require.Len(t, added, 2)
	assert.Equal(t, domain.ChatMessageRoleUser, added[0].Role)
	assert.Equal(t, "what is topos?", added[0].Content)
	assert.Equal(t, domain.ChatMessageRoleAssistant, added[1].Role)
	assert.Equal(t, "Topos is a blog platform.", added[1].Content)
	assert.Equal(t, []string{"p_1"}, added[1].CitedPostIDs)
	assert.Equal(t, "m_assistant", msg.ID)
}

func TestAskChatBuildsHistoryFromRecentTurns(t *testing.T) {
	ai := &testutil.MockAIService{
		ChatAnswerFn: func(ctx context.Context, threadID, query string, history []domain.ChatTurn, topK int) (*domain.ChatAnswer, error) {
			assert.Equal(t, "c_1", threadID)
			assert.Equal(t, []domain.ChatTurn{
				{Role: domain.ChatMessageRoleUser, Content: "first"},
				{Role: domain.ChatMessageRoleAssistant, Content: "answer"},
			}, history)
			return &domain.ChatAnswer{Content: "ok"}, nil
		},
	}
	repo := &testutil.MockChatRepository{
		UserID: "u_1",
		MessagesFn: func(ctx context.Context, chatID string, page, limit int) (*domain.PaginatedMessages, error) {
			assert.Equal(t, "c_1", chatID)
			assert.Equal(t, 1, page)
			assert.Equal(t, chatHistoryTurns, limit)
			return &domain.PaginatedMessages{
				Messages: []*domain.ChatMessage{
					{Role: domain.ChatMessageRoleAssistant, Content: "answer"},
					{Role: domain.ChatMessageRoleUser, Content: "first"},
				},
			}, nil
		},
	}
	s := newChatService(t, repo, ai)

	_, err := s.AskChat(context.Background(), "c_1", "u_1", "next?")

	require.NoError(t, err)
}

func TestAskChatFailsWhenAIErrors(t *testing.T) {
	aiErr := errors.New("ai down")
	ai := &testutil.MockAIService{
		ChatAnswerFn: func(ctx context.Context, threadID, query string, history []domain.ChatTurn, topK int) (*domain.ChatAnswer, error) {
			return nil, aiErr
		},
	}
	var added []*domain.ChatMessage
	repo := &testutil.MockChatRepository{
		UserID: "u_1",
		AddMessageFn: func(ctx context.Context, msg *domain.ChatMessage) (*domain.ChatMessage, error) {
			added = append(added, msg)
			return msg, nil
		},
	}
	s := newChatService(t, repo, ai)

	_, err := s.AskChat(context.Background(), "c_1", "u_1", "hi")

	assert.ErrorIs(t, err, aiErr)
	assert.Empty(t, added, "a failed AI call must not leave a ghost user message behind")
	assert.Zero(t, repo.DeleteMessageCalls)
}

func TestAskChatRollsBackUserMessageWhenAssistantPersistFails(t *testing.T) {
	ai := &testutil.MockAIService{
		ChatAnswerFn: func(ctx context.Context, threadID, query string, history []domain.ChatTurn, topK int) (*domain.ChatAnswer, error) {
			return &domain.ChatAnswer{Content: "ok"}, nil
		},
	}
	persistErr := errors.New("mongo down")
	repo := &testutil.MockChatRepository{
		UserID: "u_1",
		AddMessageFn: func(ctx context.Context, msg *domain.ChatMessage) (*domain.ChatMessage, error) {
			if msg.Role == domain.ChatMessageRoleAssistant {
				return nil, persistErr
			}
			msg.ID = "m_user"
			return msg, nil
		},
	}
	s := newChatService(t, repo, ai)

	_, err := s.AskChat(context.Background(), "c_1", "u_1", "hi")

	assert.ErrorIs(t, err, persistErr)
	require.Equal(t, 1, repo.DeleteMessageCalls)
	assert.Equal(t, "c_1", repo.DeleteMessageChatID)
	assert.Equal(t, "m_user", repo.DeleteMessageID)
}

func TestAskChatToleratesFailedRollback(t *testing.T) {
	ai := &testutil.MockAIService{
		ChatAnswerFn: func(ctx context.Context, threadID, query string, history []domain.ChatTurn, topK int) (*domain.ChatAnswer, error) {
			return &domain.ChatAnswer{Content: "ok"}, nil
		},
	}
	persistErr := errors.New("mongo down")
	repo := &testutil.MockChatRepository{
		UserID: "u_1",
		AddMessageFn: func(ctx context.Context, msg *domain.ChatMessage) (*domain.ChatMessage, error) {
			if msg.Role == domain.ChatMessageRoleAssistant {
				return nil, persistErr
			}
			msg.ID = "m_user"
			return msg, nil
		},
		DeleteMessageFn: func(ctx context.Context, chatID, messageID string) error {
			return errors.New("rollback also failed")
		},
	}
	s := newChatService(t, repo, ai)

	_, err := s.AskChat(context.Background(), "c_1", "u_1", "hi")

	assert.ErrorIs(t, err, persistErr, "the original persist error must win even when rollback fails")
}
