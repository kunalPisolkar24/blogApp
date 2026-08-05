package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/kunalPisolkar24/topos/services/content/internal/config"
)

type contextKey string

const userIDKey contextKey = "userId"

// UserIDFromContext returns the authenticated user id, if any.
func UserIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(userIDKey).(string)
	return v, ok && v != ""
}

// AuthMiddleware parses the Bearer token, validates it against the JWT
// config, and injects the user id into the request context. Requests
// without a valid token pass through unauthenticated.
func AuthMiddleware(cfg config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := userIDFromRequest(r, cfg)
			if !ok {
				next.ServeHTTP(w, r)
				return
			}

			ctx := context.WithValue(r.Context(), userIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func userIDFromRequest(r *http.Request, cfg config.Config) (string, bool) {
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return "", false
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
		return "", false
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", false
	}

	userID, ok := idFromClaims(claims)
	return userID, ok
}

func idFromClaims(claims jwt.MapClaims) (string, bool) {
	id, exists := claims["id"]
	if !exists {
		return "", false
	}

	switch v := id.(type) {
	case string:
		return v, v != ""
	case float64:
		return fmt.Sprintf("%.0f", v), true
	default:
		return "", false
	}
}
