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

func runThroughAuth(t *testing.T, header string) (userID string, ok bool) {
	t.Helper()

	handler := AuthMiddleware(testConfig())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	handler.ServeHTTP(httptest.NewRecorder(), req)
	return userID, ok
}

func TestAuthValidToken(t *testing.T) {
	userID, ok := runThroughAuth(t, "Bearer "+signToken(t, validClaims("u_1")))
	assert.True(t, ok)
	assert.Equal(t, "u_1", userID)
}

func TestAuthNumericID(t *testing.T) {
	claims := validClaims("42")
	claims["id"] = float64(42)
	userID, ok := runThroughAuth(t, "Bearer "+signToken(t, claims))
	assert.True(t, ok)
	assert.Equal(t, "42", userID)
}

func TestAuthMissingHeader(t *testing.T) {
	_, ok := runThroughAuth(t, "")
	assert.False(t, ok)
}

func TestAuthNonBearerHeader(t *testing.T) {
	_, ok := runThroughAuth(t, "Basic abc")
	assert.False(t, ok)
}

func TestAuthExpiredToken(t *testing.T) {
	claims := validClaims("u_1")
	claims["exp"] = time.Now().Add(-time.Hour).Unix()
	_, ok := runThroughAuth(t, "Bearer "+signToken(t, claims))
	assert.False(t, ok)
}

func TestAuthWrongIssuer(t *testing.T) {
	claims := validClaims("u_1")
	claims["iss"] = "someone-else"
	_, ok := runThroughAuth(t, "Bearer "+signToken(t, claims))
	assert.False(t, ok)
}

func TestAuthWrongAudience(t *testing.T) {
	claims := validClaims("u_1")
	claims["aud"] = "someone-else"
	_, ok := runThroughAuth(t, "Bearer "+signToken(t, claims))
	assert.False(t, ok)
}

func TestAuthWrongSigningMethod(t *testing.T) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS512, validClaims("u_1"))
	signed, err := token.SignedString([]byte(testSecret))
	require.NoError(t, err)
	_, ok := runThroughAuth(t, "Bearer "+signed)
	assert.False(t, ok)
}

func TestAuthMissingIDClaim(t *testing.T) {
	claims := validClaims("")
	delete(claims, "id")
	_, ok := runThroughAuth(t, "Bearer "+signToken(t, claims))
	assert.False(t, ok)
}

func TestAuthEmptyIDClaim(t *testing.T) {
	_, ok := runThroughAuth(t, "Bearer "+signToken(t, validClaims("")))
	assert.False(t, ok)
}

func TestAuthGarbageToken(t *testing.T) {
	_, ok := runThroughAuth(t, "Bearer not.a.token")
	assert.False(t, ok)
}

func TestIDFromClaimsUnsupportedType(t *testing.T) {
	_, ok := idFromClaims(jwt.MapClaims{"id": []string{"x"}})
	assert.False(t, ok)

	userID, ok := idFromClaims(jwt.MapClaims{"id": 3.5})
	assert.True(t, ok)
	assert.Equal(t, "4", userID)
}
