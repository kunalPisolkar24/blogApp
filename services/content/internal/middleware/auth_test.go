package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/kunalPisolkar24/topos/services/content/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSecret = "test-secret"

func testConfig() config.Config {
	return config.Config{
		JwtSecret:   testSecret,
		JwtIssuer:   "user-service",
		JwtAudience: "topos",
	}
}

func signToken(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(testSecret))
	require.NoError(t, err)
	return signed
}

func validClaims(id string) jwt.MapClaims {
	return jwt.MapClaims{
		"id":  id,
		"iss": "user-service",
		"aud": "topos",
		"exp": time.Now().Add(time.Hour).Unix(),
	}
}

func runThroughAuth(t *testing.T, header string) (userID string, ok bool, status int) {
	t.Helper()

	handler := AuthMiddleware(testConfig())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return userID, ok, rec.Code
}

func TestAuthValidToken(t *testing.T) {
	userID, ok, status := runThroughAuth(t, "Bearer "+signToken(t, validClaims("u_1")))
	assert.True(t, ok)
	assert.Equal(t, "u_1", userID)
	assert.Equal(t, http.StatusOK, status)
}

func TestAuthNumericIDRejected(t *testing.T) {
	claims := validClaims("42")
	claims["id"] = float64(42)
	_, ok, status := runThroughAuth(t, "Bearer "+signToken(t, claims))
	assert.False(t, ok)
	assert.Equal(t, http.StatusUnauthorized, status, "numeric id claims must be rejected, not rounded")
}

func TestAuthMissingHeaderAnonymous(t *testing.T) {
	_, ok, status := runThroughAuth(t, "")
	assert.False(t, ok)
	assert.Equal(t, http.StatusOK, status, "headerless requests pass through anonymously")
}

func TestAuthNonBearerHeaderRejected(t *testing.T) {
	_, ok, status := runThroughAuth(t, "Basic abc")
	assert.False(t, ok)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestAuthExpiredTokenRejected(t *testing.T) {
	claims := validClaims("u_1")
	claims["exp"] = time.Now().Add(-time.Hour).Unix()
	_, ok, status := runThroughAuth(t, "Bearer "+signToken(t, claims))
	assert.False(t, ok)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestAuthWrongIssuerRejected(t *testing.T) {
	claims := validClaims("u_1")
	claims["iss"] = "someone-else"
	_, ok, status := runThroughAuth(t, "Bearer "+signToken(t, claims))
	assert.False(t, ok)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestAuthWrongAudienceRejected(t *testing.T) {
	claims := validClaims("u_1")
	claims["aud"] = "someone-else"
	_, ok, status := runThroughAuth(t, "Bearer "+signToken(t, claims))
	assert.False(t, ok)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestAuthWrongSigningMethodRejected(t *testing.T) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS512, validClaims("u_1"))
	signed, err := token.SignedString([]byte(testSecret))
	require.NoError(t, err)
	_, ok, status := runThroughAuth(t, "Bearer "+signed)
	assert.False(t, ok)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestAuthMissingIDClaimRejected(t *testing.T) {
	claims := validClaims("")
	delete(claims, "id")
	_, ok, status := runThroughAuth(t, "Bearer "+signToken(t, claims))
	assert.False(t, ok)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestAuthEmptyIDClaimRejected(t *testing.T) {
	_, ok, status := runThroughAuth(t, "Bearer "+signToken(t, validClaims("")))
	assert.False(t, ok)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestAuthGarbageTokenRejected(t *testing.T) {
	_, ok, status := runThroughAuth(t, "Bearer not.a.token")
	assert.False(t, ok)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestIDFromClaimsStringOnly(t *testing.T) {
	userID, ok := idFromClaims(jwt.MapClaims{"id": "u_1"})
	assert.True(t, ok)
	assert.Equal(t, "u_1", userID)

	_, ok = idFromClaims(jwt.MapClaims{"id": []string{"x"}})
	assert.False(t, ok)

	_, ok = idFromClaims(jwt.MapClaims{"id": 3.5})
	assert.False(t, ok, "non-integer numeric ids must be rejected")

	// 2^53 + 1 cannot be represented by float64; accepting it would let
	// two distinct users decode to the same id.
	_, ok = idFromClaims(jwt.MapClaims{"id": float64(1<<53) + 1})
	assert.False(t, ok, "large numeric ids must be rejected instead of losing precision")

	_, ok = idFromClaims(jwt.MapClaims{"id": ""})
	assert.False(t, ok)
}
