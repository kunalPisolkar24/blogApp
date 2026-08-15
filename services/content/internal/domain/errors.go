package domain

import "errors"

var (
	ErrNotFound     = errors.New("not found")
	ErrForbidden    = errors.New("forbidden")
	ErrUnauthorized = errors.New("unauthorized")
	// ErrValidation marks client input that failed service-layer
	// validation. The wrapped message is safe to surface to the client.
	ErrValidation = errors.New("validation error")
)
