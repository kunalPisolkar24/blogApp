package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

// postFetcher is the slice of PostService the internal endpoint needs.
type postFetcher interface {
	GetPost(ctx context.Context, id string) (*domain.Post, error)
}

// internalPostBodyHandler serves full post bodies to trusted internal
// callers (the AI service's get_post_body tool). Responses carry only
// the fields grounding needs.
func internalPostBodyHandler(posts postFetcher) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		post, err := posts.GetPost(r.Context(), r.PathValue("id"))
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				http.Error(w, "post not found", http.StatusNotFound)
				return
			}
			http.Error(w, "failed to fetch post", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{
			"id":    post.ID,
			"title": post.Title,
			"body":  post.Body,
		}); err != nil {
			http.Error(w, "failed to encode post", http.StatusInternalServerError)
		}
	}
}
