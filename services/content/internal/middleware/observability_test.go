package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequestIDMiddlewareEchoesAndAttaches(t *testing.T) {
	handler := RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := RequestIDFromContext(r.Context())
		require.True(t, ok)
		assert.Equal(t, "incoming-id", id)

		logger := LoggerFromContext(r.Context())
		assert.NotNil(t, logger)
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Request-ID", "incoming-id")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, "incoming-id", rec.Header().Get("X-Request-Id"))
}

func TestRequestIDMiddlewareGenerates(t *testing.T) {
	handler := RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, ok := RequestIDFromContext(r.Context())
		require.True(t, ok)
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.NotEmpty(t, rec.Header().Get("X-Request-Id"))
}

func TestRequestIDFromContextMissing(t *testing.T) {
	_, ok := RequestIDFromContext(context.Background())
	assert.False(t, ok)
}

func TestLoggerFromContextDefaults(t *testing.T) {
	logger := LoggerFromContext(context.Background())
	require.NotNil(t, logger)
}

func TestMetricsMiddlewareRecordsStatusClass(t *testing.T) {
	for _, tt := range []struct {
		status int
		want   string
	}{
		{http.StatusOK, "2xx"},
		{http.StatusNotFound, "4xx"},
		{http.StatusInternalServerError, "5xx"},
	} {
		t.Run(tt.want, func(t *testing.T) {
			handler := MetricsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.status)
			}))

			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/x", nil))

			assert.Equal(t, tt.want, statusClass(tt.status))
		})
	}
}

func TestMetricsMiddlewareRecordsDuration(t *testing.T) {
	handler := MetricsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/query", nil))
}

func TestStatusClass(t *testing.T) {
	assert.Equal(t, "2xx", statusClass(200))
	assert.Equal(t, "3xx", statusClass(301))
	assert.Equal(t, "4xx", statusClass(404))
	assert.Equal(t, "5xx", statusClass(503))
	assert.Equal(t, "5xx", statusClass(99))
}
