package graph

import (
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
)

// Resolver holds the dependencies used by all resolvers.
type Resolver struct {
	PostService *service.PostService
	TagService  *service.TagService
	ChatService *service.ChatService
}

func NewResolver(postService *service.PostService, tagService *service.TagService, chatService *service.ChatService) *Resolver {
	return &Resolver{
		PostService: postService,
		TagService:  tagService,
		ChatService: chatService,
	}
}
