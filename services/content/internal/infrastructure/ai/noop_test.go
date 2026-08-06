package ai

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNoopGenerateSummary(t *testing.T) {
	a := NewNoopAI()

	summary, err := a.GenerateSummary(context.Background(), "Hello world, this is a test.")
	require.NoError(t, err)
	assert.Equal(t, "Hello world, this is a test.", summary)

	summary, err = a.GenerateSummary(context.Background(), "")
	require.NoError(t, err)
	assert.Equal(t, "Summary is currently unavailable.", summary)
}

func TestNoopGenerateSummaryTruncates(t *testing.T) {
	a := NewNoopAI()
	long := make([]rune, 500)
	for i := range long {
		long[i] = 'a'
	}

	summary, err := a.GenerateSummary(context.Background(), string(long))
	require.NoError(t, err)
	assert.LessOrEqual(t, len(summary), 244)
	assert.Contains(t, summary, "...")
}

func TestNoopGenerateTags(t *testing.T) {
	a := NewNoopAI()

	tags, err := a.GenerateTags(context.Background(), "Hello World", "learning about Go programming")
	require.NoError(t, err)
	assert.Contains(t, tags, "hello")
	assert.Contains(t, tags, "learning")
	assert.NotContains(t, tags, "the")
	assert.LessOrEqual(t, len(tags), 5)
}

func TestNoopGenerateTagsEmpty(t *testing.T) {
	a := NewNoopAI()

	tags, err := a.GenerateTags(context.Background(), "", "")
	require.NoError(t, err)
	assert.Equal(t, []string{"general"}, tags)
}

func TestNoopGeneratePost(t *testing.T) {
	a := NewNoopAI()

	post, err := a.GeneratePost(context.Background(), "A prompt about Go")
	require.NoError(t, err)
	assert.Equal(t, "A prompt about Go", post.Title)
	assert.NotEmpty(t, post.Body)
	assert.NotEmpty(t, post.Summary)
	assert.NotEmpty(t, post.Tags)

	post, err = a.GeneratePost(context.Background(), "")
	require.NoError(t, err)
	assert.Equal(t, "Generated Post", post.Title)
	assert.NotEmpty(t, post.Body)
}

func TestNoopClose(t *testing.T) {
	require.NoError(t, NewNoopAI().Close())
}

func TestTruncate(t *testing.T) {
	assert.Equal(t, "", truncate("hello", 0))
	assert.Equal(t, "hello", truncate("hello", 5))
	assert.Equal(t, "hello...", truncate("hello world", 7))
	assert.Equal(t, "héllo...", truncate("héllo world", 6))
}

func TestNormalizeWhitespace(t *testing.T) {
	assert.Equal(t, "a b c", normalizeWhitespace("  a\t b\n  c  "))
	assert.Equal(t, "", normalizeWhitespace("   "))
}

func TestDeriveTagsStopsAtFive(t *testing.T) {
	tags := deriveTags("one two three four five six seven", "")
	assert.Len(t, tags, 5)
}

func TestDeriveTagsSkipsStopWords(t *testing.T) {
	tags := deriveTags("the and for this", "")
	assert.Equal(t, []string{"general"}, tags)
}
