package domain

import "errors"

var (
	ErrNotFound     = errors.New("not found")
	ErrForbidden    = errors.New("forbidden")
	ErrUnauthorized = errors.New("unauthorized")
	// ErrConflict marks a state transition that lost a race: another
	// request already moved the resource to an incompatible status.
	ErrConflict = errors.New("conflict")
	// ErrValidation marks client input that failed service-layer
	// validation. The wrapped message is safe to surface to the client.
	ErrValidation = errors.New("validation error")
	// ErrAICircuitOpen is returned by the resilient AI client while a
	// circuit breaker is open. Workers treat it as a deterministic,
	// fast-failing condition and dead-letter the message immediately
	// instead of burning the retry backoff.
	ErrAICircuitOpen = errors.New("ai circuit breaker open")
)
