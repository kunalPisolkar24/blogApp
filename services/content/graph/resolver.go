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
}

func NewResolver(postService *service.PostService, tagService *service.TagService, chatService *service.ChatService, interactionService *service.PostInteractionService) *Resolver {
	return &Resolver{
		PostService:        postService,
		TagService:         tagService,
		ChatService:        chatService,
		InteractionService: interactionService,
	}
}
