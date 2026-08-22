//go:build integration

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/middleware"
	"github.com/kunalPisolkar24/topos/services/content/internal/repository"
	"github.com/kunalPisolkar24/topos/services/content/internal/service"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
)

func startPostMongo(t *testing.T, ctx context.Context) *mongo.Database {
	t.Helper()

	req := testcontainers.ContainerRequest{
		Image:        "mongo:7.0",
		ExposedPorts: []string{"27017/tcp"},
		WaitingFor:   wait.ForLog("Waiting for connections").WithStartupTimeout(2 * time.Minute),
	}
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		t.Fatalf("start mongo: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	endpoint, err := container.Endpoint(ctx, "")
	if err != nil {
		t.Fatalf("mongo endpoint: %v", err)
	}
	client, err := mongo.Connect(ctx, options.Client().ApplyURI("mongodb://"+endpoint))
	if err != nil {
		t.Fatalf("connect mongo: %v", err)
	}
	t.Cleanup(func() { _ = client.Disconnect(context.Background()) })
	return client.Database("content_internal_test")
}

func TestInternalPostBodyEndToEnd(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	db := startPostMongo(t, ctx)
	repo := repository.NewMongoPostRepository(db)

	mr := miniredis.RunT(t)
	cacheClient, err := cache.New(ctx, cache.Options{Addr: mr.Addr()})
	if err != nil {
		t.Fatalf("cache: %v", err)
	}
	t.Cleanup(func() { cacheClient.Close() })

	postService := service.NewPostService(
		repo, nil, nil, &testutil.MockEventPublisher{}, cacheClient,
	)

	created, err := repo.Create(ctx, &domain.Post{Title: "Deep dive", Body: "The full body text"})
	if err != nil {
		t.Fatalf("seed post: %v", err)
	}
	seeded := *created

	mux := http.NewServeMux()
	mux.Handle(
		"GET /internal/posts/{id}",
		middleware.InternalAuthMiddleware("test-secret")(
			internalPostBodyHandler(postService),
		),
	)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	get := func(path, token string) *http.Response {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+path, nil)
		if token != "" {
			req.Header.Set(middleware.InternalTokenHeader, token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		t.Cleanup(func() { _ = resp.Body.Close() })
		return resp
	}

	t.Run("unauthorized without token", func(t *testing.T) {
		resp := get("/internal/posts/"+seeded.ID, "")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
		}
	})

	t.Run("unauthorized with wrong token", func(t *testing.T) {
		resp := get("/internal/posts/"+seeded.ID, "wrong")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
		}
	})

	t.Run("returns the full body for the right token", func(t *testing.T) {
		resp := get("/internal/posts/"+seeded.ID, "test-secret")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
		}
		var payload struct {
			ID    string `json:"id"`
			Title string `json:"title"`
			Body  string `json:"body"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if payload.ID != seeded.ID || payload.Body != seeded.Body {
			t.Fatalf("payload = %+v", payload)
		}
	})

	t.Run("404 for a missing post", func(t *testing.T) {
		resp := get("/internal/posts/507f1f77bcf86cd799439011", "test-secret")
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusNotFound)
		}
	})
}
