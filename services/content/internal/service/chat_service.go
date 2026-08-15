package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

const (
	defaultChatTitle = "New Chat"
	chatHistoryTurns = 6
	chatTopK         = 5
)

type ChatService struct {
	chatRepo domain.ChatRepository
	ai       domain.AIService
	clock    func() time.Time
}

func NewChatService(chatRepo domain.ChatRepository, aiService domain.AIService) *ChatService {
	return &ChatService{
		chatRepo: chatRepo,
		ai:       aiService,
		clock:    time.Now,
	}
}

func (s *ChatService) CreateChat(ctx context.Context, userID, title string) (*domain.Chat, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = defaultChatTitle
	}

	now := s.clock()
	chat, err := s.chatRepo.Create(ctx, &domain.Chat{
		UserID:    userID,
		Title:     title,
		CreatedAt: now,
		UpdatedAt: now,
	})
	if err != nil {
		return nil, err
	}
	return chat, nil
}

func (s *ChatService) GetChat(ctx context.Context, chatID, userID string) (*domain.Chat, error) {
	chat, err := s.chatRepo.FindByID(ctx, chatID)
	if err != nil {
		return nil, err
	}
	if chat.UserID != userID {
		return nil, domain.ErrForbidden
	}
	return chat, nil
}

func (s *ChatService) ListChats(ctx context.Context, userID string, page, limit int) (*domain.PaginatedChats, error) {
	return s.chatRepo.ListByUser(ctx, userID, page, limit)
}

func (s *ChatService) RenameChat(ctx context.Context, chatID, userID, title string) (*domain.Chat, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, fmt.Errorf("title must not be empty")
	}

	if _, err := s.GetChat(ctx, chatID, userID); err != nil {
		return nil, err
	}
	return s.chatRepo.Rename(ctx, chatID, title)
}

func (s *ChatService) DeleteChat(ctx context.Context, chatID, userID string) error {
	if _, err := s.GetChat(ctx, chatID, userID); err != nil {
		return err
	}
	return s.chatRepo.Delete(ctx, chatID)
}

func (s *ChatService) GetMessages(ctx context.Context, chatID, userID string, page, limit int) (*domain.PaginatedMessages, error) {
	if _, err := s.GetChat(ctx, chatID, userID); err != nil {
		return nil, err
	}
	return s.chatRepo.Messages(ctx, chatID, page, limit)
}

// AskChat answers a query in the given chat: the user message is
// persisted first, then the last few turns are sent to the AI service as
// context, and finally the assistant answer is persisted. The assistant
// message is returned.
func (s *ChatService) AskChat(ctx context.Context, chatID, userID, query string) (*domain.ChatMessage, error) {
	if _, err := s.GetChat(ctx, chatID, userID); err != nil {
		return nil, err
	}

	history, err := s.recentTurns(ctx, chatID)
	if err != nil {
		return nil, err
	}

	if _, err := s.chatRepo.AddMessage(ctx, &domain.ChatMessage{
		ChatID:    chatID,
		Role:      domain.ChatMessageRoleUser,
		Content:   query,
		CreatedAt: s.clock(),
	}); err != nil {
		return nil, err
	}

	answer, err := s.ai.ChatAnswer(ctx, query, history, chatTopK)
	if err != nil {
		return nil, err
	}

	return s.chatRepo.AddMessage(ctx, &domain.ChatMessage{
		ChatID:       chatID,
		Role:         domain.ChatMessageRoleAssistant,
		Content:      answer.Content,
		CitedPostIDs: answer.CitedPostIDs,
		CreatedAt:    s.clock(),
	})
}

// recentTurns loads the most recent messages of a chat and returns them
// in chronological order for use as conversation history.
func (s *ChatService) recentTurns(ctx context.Context, chatID string) ([]domain.ChatTurn, error) {
	page, err := s.chatRepo.Messages(ctx, chatID, 1, chatHistoryTurns)
	if err != nil {
		return nil, err
	}

	turns := make([]domain.ChatTurn, 0, len(page.Messages))
	for i := len(page.Messages) - 1; i >= 0; i-- {
		turns = append(turns, domain.ChatTurn{
			Role:    page.Messages[i].Role,
			Content: page.Messages[i].Content,
		})
	}
	return turns, nil
}
