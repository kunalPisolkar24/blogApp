package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func runThroughInternalAuth(serverToken, headerToken string) *httptest.ResponseRecorder {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/internal/posts/abc", nil)
	if headerToken != "" {
		req.Header.Set(InternalTokenHeader, headerToken)
	}
	rec := httptest.NewRecorder()
	InternalAuthMiddleware(serverToken)(next).ServeHTTP(rec, req)
	return rec
}

func TestInternalAuthAcceptsMatchingToken(t *testing.T) {
	rec := runThroughInternalAuth("secret", "secret")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestInternalAuthRejectsMissingToken(t *testing.T) {
	rec := runThroughInternalAuth("secret", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestInternalAuthRejectsWrongToken(t *testing.T) {
	rec := runThroughInternalAuth("secret", "wrong")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestInternalAuthDeniesEverythingWhenUnconfigured(t *testing.T) {
	rec := runThroughInternalAuth("", "secret")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
