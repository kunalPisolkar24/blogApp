package graph

import (
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
)

// Resolver holds the dependencies used by all resolvers.
type Resolver struct {
	PostService *service.PostService
	TagService  *service.TagService
}

func NewResolver(postService *service.PostService, tagService *service.TagService) *Resolver {
	return &Resolver{
		PostService: postService,
		TagService:  tagService,
	}
}
