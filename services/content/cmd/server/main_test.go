package main

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/internal/config"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

type fakePinger struct{ err error }

func (f fakePinger) Ping(ctx context.Context, rp *readpref.ReadPref) error { return f.err }

type fakeProducer struct {
	testutil.MockEventPublisher
	err error
}

func (f *fakeProducer) Ping(ctx context.Context) error { return f.err }

func (f *fakeProducer) Close() error { return nil }

func TestHealthOK(t *testing.T) {
	h := healthHandler(fakePinger{}, &fakeProducer{})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestHealthMongoDown(t *testing.T) {
	h := healthHandler(fakePinger{err: errors.New("mongo down")}, &fakeProducer{})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Contains(t, rec.Body.String(), "mongo unreachable")
}

func TestHealthKafkaDown(t *testing.T) {
	h := healthHandler(fakePinger{}, &fakeProducer{err: errors.New("kafka down")})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Contains(t, rec.Body.String(), "kafka unreachable")
}

func TestHandlerRoutes(t *testing.T) {
	cfg := config.Config{JwtSecret: "test-secret"}
	h := newHandler(cfg, nil, nil, nil)

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
	}{
		{"playground", http.MethodGet, "/", http.StatusOK},
		{"metrics", http.MethodGet, "/metrics", http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
		})
	}
}

func TestHandlerQueryExecutesResolver(t *testing.T) {
	resolver := newResolverWithMocks(t)
	cfg := config.Config{JwtSecret: "test-secret"}
	h := newHandler(cfg, resolver, nil, nil)

	req := httptest.NewRequest(http.MethodPost, "/query",
		bytes.NewBufferString(`{"query":"{ posts { posts { id } } }"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "p_1")
}

func TestHandlerSetsRequestID(t *testing.T) {
	cfg := config.Config{JwtSecret: "test-secret"}
	h := newHandler(cfg, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.NotEmpty(t, rec.Header().Get("X-Request-Id"))
}
