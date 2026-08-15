package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
)

type requestIDKey struct{}

type loggerKey struct{}

// RequestIDFromContext returns the request id attached by
// RequestIDMiddleware, if any.
func RequestIDFromContext(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(requestIDKey{}).(string)
	return id, ok && id != ""
}

// LoggerFromContext returns the request-scoped logger attached by
// RequestIDMiddleware, or the default logger when no request id is present.
func LoggerFromContext(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

// maxRequestIDLen bounds client-supplied request ids so logs and
// response headers can never be bloated or forged by request input.
const maxRequestIDLen = 64

// RequestIDMiddleware accepts an incoming X-Request-ID or generates one,
// then makes it available on the request context and on every log line
// produced from that context. Client-supplied ids outside the safe
// charset are ignored in favour of a server-generated id.
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := sanitizeRequestID(r.Header.Get("X-Request-ID"))
		if id == "" {
			id = newRequestID()
		}

		ctx := context.WithValue(r.Context(), requestIDKey{}, id)
		ctx = context.WithValue(ctx, loggerKey{}, slog.Default().With("request_id", id))
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// sanitizeRequestID accepts short ids of letters, digits and the safe
// separators -._; anything longer or containing other characters is
// rejected so a client can never inject log lines or unbounded ids.
func sanitizeRequestID(id string) string {
	if id == "" || len(id) > maxRequestIDLen {
		return ""
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
		default:
			return ""
		}
	}
	return id
}

func newRequestID() string {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(buf[:])
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// MetricsMiddleware records request count and latency by route and
// status class for every response it wraps.
func MetricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(recorder, r)

		metrics.HTTPRequestsTotal.WithLabelValues(r.URL.Path, statusClass(recorder.status)).Inc()
		metrics.HTTPRequestDuration.WithLabelValues(r.URL.Path).Observe(time.Since(start).Seconds())

		if r.URL.Path != "/metrics" {
			LoggerFromContext(r.Context()).Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", recorder.status,
				"duration_ms", time.Since(start).Milliseconds(),
			)
		}
	})
}

func statusClass(status int) string {
	switch status / 100 {
	case 2:
		return "2xx"
	case 3:
		return "3xx"
	case 4:
		return "4xx"
	default:
		return "5xx"
	}
}
