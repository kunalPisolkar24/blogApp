package graph

import (
	"errors"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

func mapDomainError(err error) *gqlerror.Error {
	switch {
	case errors.Is(err, domain.ErrUnauthorized):
		return &gqlerror.Error{Message: "unauthorized"}
	case errors.Is(err, domain.ErrForbidden):
		return &gqlerror.Error{Message: "forbidden"}
	case errors.Is(err, domain.ErrNotFound):
		return &gqlerror.Error{Message: "not found"}
	case errors.Is(err, domain.ErrValidation):
		return &gqlerror.Error{Message: err.Error()}
	default:
		return gqlerror.Wrap(err)
	}
}
