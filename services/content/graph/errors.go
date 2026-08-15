package graph

import (
	"context"
	"errors"
	"log/slog"

	"github.com/99designs/gqlgen/graphql"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
	"github.com/kunalPisolkar24/topos/services/content/internal/middleware"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

// errorKindExtension marks gqlerror.Errors produced by mapDomainError so
// the error presenter can classify them without string matching.
const errorKindExtension = "kind"

// mapDomainError converts a service error into a client-safe GraphQL
// error. Unexpected errors keep a generic message and the original error
// is preserved (wrapped) so the presenter can log it.
func mapDomainError(err error) *gqlerror.Error {
	var gqlErr *gqlerror.Error
	if errors.As(err, &gqlErr) {
		return gqlErr
	}

	kind, message := "internal", "internal error"
	switch {
	case errors.Is(err, domain.ErrUnauthorized):
		kind, message = "unauthorized", "unauthorized"
	case errors.Is(err, domain.ErrForbidden):
		kind, message = "forbidden", "forbidden"
	case errors.Is(err, domain.ErrNotFound):
		kind, message = "not_found", "not found"
	case errors.Is(err, domain.ErrValidation):
		kind, message = "validation", err.Error()
	}

	return &gqlerror.Error{
		Message:    message,
		Extensions: map[string]any{errorKindExtension: kind},
	}
}

// PresentError is the gqlgen error presenter. Safe messages are passed
// through; anything unexpected is never leaked to the client - it is
// logged with the request id and returned as a generic "internal error".
// Every error is counted by operation and kind.
func PresentError(ctx context.Context, err error) *gqlerror.Error {
	var gqlErr *gqlerror.Error
	kind := "internal"
	if errors.As(err, &gqlErr) {
		if k, ok := gqlErr.Extensions[errorKindExtension].(string); ok && k != "" {
			kind = k
		} else if len(gqlErr.Path) > 0 || len(gqlErr.Locations) > 0 {
			// Query validation and protocol errors are client-safe.
			kind = "client"
		}
	}

	message := "internal error"
	if kind != "internal" {
		if gqlErr != nil {
			message = gqlErr.Message
		} else {
			message = err.Error()
		}
	} else {
		slog.Error("graphql operation failed",
			"error", err,
			"request_id", requestIDFromContext(ctx),
			"operation", operationName(ctx),
		)
	}

	metrics.GraphQLErrorsTotal.WithLabelValues(operationName(ctx), kind).Inc()

	out := &gqlerror.Error{Message: message}
	if gqlErr != nil {
		out.Path = gqlErr.Path
	}
	if rid, ok := middleware.RequestIDFromContext(ctx); ok {
		out.Extensions = map[string]any{"request_id": rid}
	}
	return out
}

// RecoverError converts a resolver panic into a generic error. The
// panic details are logged server-side; the client only sees
// "internal error" (which the presenter classifies and counts as
// internal).
func RecoverError(ctx context.Context, recovered any) (userMessage error) {
	slog.Error("graphql resolver panic",
		"panic", recovered,
		"request_id", requestIDFromContext(ctx),
		"operation", operationName(ctx),
	)
	metrics.GraphQLErrorsTotal.WithLabelValues(operationName(ctx), "internal").Inc()
	return errors.New("internal error")
}

func operationName(ctx context.Context) string {
	if opCtx := graphql.GetOperationContext(ctx); opCtx != nil && opCtx.OperationName != "" {
		return opCtx.OperationName
	}
	return "anonymous"
}

func requestIDFromContext(ctx context.Context) string {
	rid, _ := middleware.RequestIDFromContext(ctx)
	return rid
}
