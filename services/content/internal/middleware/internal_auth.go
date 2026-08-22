package middleware

import (
	"crypto/subtle"
	"net/http"
)

// InternalTokenHeader carries the shared service-to-service token.
const InternalTokenHeader = "X-Internal-Secret"

// InternalAuthMiddleware guards service-internal endpoints with a
// constant-time comparison against the configured token. Requests
// without an exact match are rejected before reaching the handler; a
// missing server-side token denies everything, so an unconfigured
// deployment never silently exposes internal routes.
func InternalAuthMiddleware(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token == "" ||
				subtle.ConstantTimeCompare(
					[]byte(r.Header.Get(InternalTokenHeader)),
					[]byte(token),
				) != 1 {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
