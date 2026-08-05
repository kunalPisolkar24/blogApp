package middleware

import (
	"context"
	"net/http"
)

type contextKey string

const userIDKey contextKey = "userId"

// UserIDFromContext returns the authenticated user id, if any.
func UserIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(userIDKey).(string)
	return v, ok && v != ""
}

// UserIDMiddleware injects the user id from the X-User-Id header into the
// request context. Temporary dev stand-in until JWT auth is added.
func UserIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), userIDKey, r.Header.Get("X-User-Id"))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
