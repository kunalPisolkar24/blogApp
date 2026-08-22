package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

type fakePostFetcher struct {
	post *domain.Post
	err  error
}

func (f fakePostFetcher) GetPost(ctx context.Context, id string) (*domain.Post, error) {
	return f.post, f.err
}

func serveInternalPost(t *testing.T, fetcher postFetcher, path string) *httptest.ResponseRecorder {
	t.Helper()

	mux := http.NewServeMux()
	mux.Handle(
		"GET /internal/posts/{id}",
		internalPostBodyHandler(fetcher),
	)

	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestInternalPostBodyReturnsMinimalJSON(t *testing.T) {
	fetcher := fakePostFetcher{post: &domain.Post{
		ID: "507f1f77bcf86cd799439011", Title: "Hello", Body: "Full body",
	}}

	rec := serveInternalPost(
		t, fetcher, "/internal/posts/507f1f77bcf86cd799439011",
	)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["id"] != "507f1f77bcf86cd799439011" ||
		payload["title"] != "Hello" || payload["body"] != "Full body" {
		t.Fatalf("payload = %v", payload)
	}
}

func TestInternalPostBodyMapsNotFoundTo404(t *testing.T) {
	fetcher := fakePostFetcher{
		err: fmt.Errorf("%w: missing", domain.ErrNotFound),
	}

	rec := serveInternalPost(
		t, fetcher, "/internal/posts/507f1f77bcf86cd799439011",
	)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestInternalPostBodyMapsOtherErrorsTo500(t *testing.T) {
	fetcher := fakePostFetcher{err: errors.New("mongo down")}

	rec := serveInternalPost(
		t, fetcher, "/internal/posts/507f1f77bcf86cd799439011",
	)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}
