package middleware

import (
	"net/http"
	"runtime/debug"

	"log/slog"

	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
)

// RecoverMiddleware catches panics from the wrapped handler chain so a
// buggy resolver or client never takes down the whole process. The
// panic is logged with the stack and request id, and the client gets a
// plain 500.
func RecoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				metrics.HTTPPanicsTotal.Inc()
				rid, _ := RequestIDFromContext(r.Context())
				slog.Error("panic recovered in handler chain",
					"panic", recovered,
					"request_id", rid,
					"path", r.URL.Path,
					"stack", string(debug.Stack()),
				)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
