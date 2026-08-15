package slug

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerate(t *testing.T) {
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	suffix := "-20260806120000.000000000"

	tests := []struct {
		name  string
		title string
		want  string
	}{
		{"simple title", "Hello World", "hello-world" + suffix},
		{"keeps digits", "Go 1.25 Released", "go-1-25-released" + suffix},
		{"punctuation becomes dashes", "What's New?!", "what-s-new" + suffix},
		{"collapses separators", "A  --  B __ C", "a-b-c" + suffix},
		{"trailing separator trimmed", "Trailing-", "trailing" + suffix},
		{"uppercase lowered", "BLOG POST", "blog-post" + suffix},
		{"unicode letters kept", "Café Zürich", "café-zürich" + suffix},
		{"only punctuation", "!!?!", "post" + suffix},
		{"empty title", "", "post" + suffix},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, Generate(tt.title, now))
		})
	}
}

func TestGenerateUniquePerTimestamp(t *testing.T) {
	require.NotEqual(t,
		Generate("Title", time.Unix(1000, 0)),
		Generate("Title", time.Unix(2000, 0)),
	)
}

func TestGenerateUniqueWithinSameSecond(t *testing.T) {
	require.NotEqual(t,
		Generate("Title", time.Unix(1000, 111)),
		Generate("Title", time.Unix(1000, 222)),
	)
}

func TestGenerateUsesUTC(t *testing.T) {
	local := time.Date(2026, 8, 6, 16, 0, 0, 0, time.FixedZone("UTC+4", 4*3600))
	utc := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)

	assert.Equal(t, Generate("Title", local), Generate("Title", utc), "the suffix must not depend on the server timezone")
	assert.Contains(t, Generate("Title", local), "-20260806120000.")
}
