package graph

import (
	"context"
	"errors"
	"testing"

	"github.com/99designs/gqlgen/graphql"
)

func TestPresentErrorWithMalformedRequest(t *testing.T) {
	// Request-level errors (parse/validation failures) reach the error
	// presenter without an operation context. PresentError must not
	// panic on them: it should fall back to "anonymous" and produce a
	// generic internal error instead.
	err := PresentError(context.Background(), errors.New("boom"))

	if err == nil {
		t.Fatal("expected a presented error")
	}
	if err.Message != "internal error" {
		t.Fatalf("expected generic message, got %q", err.Message)
	}
}

func TestPresentErrorWithOperationContext(t *testing.T) {
	ctx := graphql.WithOperationContext(context.Background(), &graphql.OperationContext{
		OperationName: "Posts",
	})

	err := PresentError(ctx, errors.New("boom"))

	if err == nil {
		t.Fatal("expected a presented error")
	}
	if err.Message != "internal error" {
		t.Fatalf("expected generic message, got %q", err.Message)
	}
}

func TestRecoverErrorWithMalformedRequest(t *testing.T) {
	// The recover path logs with operationName, which must tolerate a
	// missing operation context instead of panicking inside the panic
	// handler.
	userMessage := RecoverError(context.Background(), "boom")

	if userMessage == nil || userMessage.Error() != "internal error" {
		t.Fatalf("expected internal error, got %v", userMessage)
	}
}

func TestOperationNameFallsBackWithoutContext(t *testing.T) {
	if got := operationName(context.Background()); got != "anonymous" {
		t.Fatalf("expected anonymous, got %q", got)
	}

	ctx := graphql.WithOperationContext(context.Background(), &graphql.OperationContext{
		OperationName: "Posts",
	})
	if got := operationName(ctx); got != "Posts" {
		t.Fatalf("expected Posts, got %q", got)
	}
}