package middleware

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/kunalPisolkar24/topos/services/content/internal/config"
)

type contextKey string

const userIDKey contextKey = "userId"

// UserIDFromContext returns the authenticated user id, if any.
// WithUserID returns a context carrying the authenticated user id.
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

func UserIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(userIDKey).(string)
	return v, ok && v != ""
}

// AuthMiddleware validates Bearer tokens and injects the user id into
// the request context. Headerless requests pass through anonymously;
// any request carrying an Authorization header that is not a valid
// Bearer token gets 401 Unauthorized, so a broken or expired token can
// never be silently downgraded to anonymous access.
func AuthMiddleware(cfg config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				next.ServeHTTP(w, r)
				return
			}

			userID, err := userIDFromHeader(authHeader, cfg)
			if err != nil {
				http.Error(w, err.Error(), http.StatusUnauthorized)
				return
			}

			if userID != "" {
				ctx := context.WithValue(r.Context(), userIDKey, userID)
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// userIDFromHeader extracts and validates the user id from an
// Authorization header. It only accepts Bearer tokens; anything else is
// an error so the caller can reject it.
func userIDFromHeader(authHeader string, cfg config.Config) (string, error) {
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return "", errors.New("unauthorized: unsupported authorization scheme")
	}

	token, err := jwt.Parse(
		strings.TrimPrefix(authHeader, "Bearer "),
		func(token *jwt.Token) (any, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(cfg.JwtSecret), nil
		},
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer(cfg.JwtIssuer),
		jwt.WithAudience(cfg.JwtAudience),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !token.Valid {
		return "", errors.New("unauthorized: invalid or expired token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("unauthorized: invalid token claims")
	}

	userID, ok := idFromClaims(claims)
	if !ok {
		return "", errors.New("unauthorized: token is missing a valid id claim")
	}
	return userID, nil
}

func idFromClaims(claims jwt.MapClaims) (string, bool) {
	id, exists := claims["id"]
	if !exists {
		return "", false
	}

	// Only string ids are accepted. JSON numbers decode to float64,
	// which cannot represent integers above 2^53 exactly, so distinct
	// users could collapse into the same userID; numeric ids from the
	// user service must be issued as strings.
	userID, ok := id.(string)
	if !ok || userID == "" {
		return "", false
	}
	return userID, true
}
