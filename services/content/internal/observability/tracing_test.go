package observability

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestSetupTracingDisabled(t *testing.T) {
	shutdown, err := SetupTracing(context.Background(), "  ", "test-service")
	require.NoError(t, err)
	require.NoError(t, shutdown(context.Background()))
}

func TestSetupTracingEnabled(t *testing.T) {
	// The OTLP exporter connects lazily, so an unreachable endpoint is
	// fine here: we only assert the wiring and that shutdown does not
	// block.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	shutdown, err := SetupTracing(ctx, "127.0.0.1:14317", "test-service")
	require.NoError(t, err)
	require.NotNil(t, shutdown)

	done := make(chan error, 1)
	go func() { done <- shutdown(context.Background()) }()
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(35 * time.Second):
		t.Fatal("shutdown hung")
	}
}
