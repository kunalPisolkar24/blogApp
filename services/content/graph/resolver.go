package graph

import (
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
)

// Resolver holds the dependencies used by all resolvers.
type Resolver struct {
	PostService        *service.PostService
	TagService         *service.TagService
	ChatService        *service.ChatService
	InteractionService *service.PostInteractionService
	DraftService       *service.PostDraftService
}

func NewResolver(postService *service.PostService, tagService *service.TagService, chatService *service.ChatService, interactionService *service.PostInteractionService, draftService *service.PostDraftService) *Resolver {
	return &Resolver{
		PostService:        postService,
		TagService:         tagService,
		ChatService:        chatService,
		InteractionService: interactionService,
		DraftService:       draftService,
	}
}
