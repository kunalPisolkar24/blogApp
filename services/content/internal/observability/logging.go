// Package observability centralizes logging and tracing setup shared by
// the API server and the worker so both processes behave identically.
package observability

import (
	"log/slog"
	"os"
	"strings"
)

// SetupLogging installs the default slog logger. format is "json" or
// "text" (anything else falls back to json); level is one of debug,
// info, warn, error (anything else falls back to info). Every log line
// carries the service name so logs from different processes can be
// filtered independently.
func SetupLogging(format, level, service string) {
	var handler slog.Handler
	handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: parseLevel(level)})
	if strings.EqualFold(format, "text") {
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: parseLevel(level)})
	}
	slog.SetDefault(slog.New(handler).With("service", service))
}

func parseLevel(value string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
