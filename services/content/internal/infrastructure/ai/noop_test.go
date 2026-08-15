package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNoopGenerateSummaryUnavailable(t *testing.T) {
	a := NewNoopAI()

	_, err := a.GenerateSummary(context.Background(), "Hello world, this is a test.")
	assert.ErrorIs(t, err, domain.ErrAICircuitOpen)
}

func TestNoopGenerateTagsUnavailable(t *testing.T) {
	a := NewNoopAI()

	_, err := a.GenerateTags(context.Background(), "Hello World", "learning about Go programming")
	assert.ErrorIs(t, err, domain.ErrAICircuitOpen)
}

func TestNoopGeneratePostUnavailable(t *testing.T) {
	a := NewNoopAI()

	_, err := a.GeneratePost(context.Background(), "A prompt about Go")
	assert.ErrorIs(t, err, domain.ErrAICircuitOpen)
}

func TestNoopClose(t *testing.T) {
	require.NoError(t, NewNoopAI().Close())
}

func TestNoopGenerationErrorsAreCircuitOpen(t *testing.T) {
	a := NewNoopAI()

	_, err := a.GenerateSummary(context.Background(), "text")
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrAICircuitOpen), "callers must be able to match the sentinel")
}
