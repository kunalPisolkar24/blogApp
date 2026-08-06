package observability

import (
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseLevel(t *testing.T) {
	tests := []struct {
		in   string
		want slog.Level
	}{
		{"debug", slog.LevelDebug},
		{"warn", slog.LevelWarn},
		{"error", slog.LevelError},
		{"info", slog.LevelInfo},
		{"INFO", slog.LevelInfo},
		{"warning", slog.LevelInfo},
		{"", slog.LevelInfo},
		{"  debug  ", slog.LevelDebug},
	}

	for _, tt := range tests {
		assert.Equal(t, tt.want, parseLevel(tt.in), "parseLevel(%q)", tt.in)
	}
}

func TestSetupLogging(t *testing.T) {
	SetupLogging("json", "debug", "test-service")

	logger := slog.Default()
	assert.True(t, logger.Handler().Enabled(nil, slog.LevelDebug))
}

func TestSetupLoggingTextFormat(t *testing.T) {
	SetupLogging("text", "error", "test-service")

	logger := slog.Default()
	assert.False(t, logger.Handler().Enabled(nil, slog.LevelInfo))
	assert.True(t, logger.Handler().Enabled(nil, slog.LevelError))
}
