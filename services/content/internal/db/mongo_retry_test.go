package db

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/mongo"
)

func TestConnectWithRetrySucceedsOnFirstPing(t *testing.T) {
	var pings atomic.Int32
	err := connectWithRetry(context.Background(), func(ctx context.Context, _ *mongo.Client) error {
		pings.Add(1)
		return nil
	}, nil)

	require.NoError(t, err)
	assert.Equal(t, int32(1), pings.Load())
}

func TestConnectWithRetryRecoversFromTransientFailures(t *testing.T) {
	ctx := context.Background()

	now := time.Now()
	var pings atomic.Int32
	err := connectWithRetry(ctx, func(ctx context.Context, _ *mongo.Client) error {
		if pings.Add(1) < 3 {
			return errors.New("connection refused")
		}
		return nil
	}, nil)

	require.NoError(t, err)
	assert.Equal(t, int32(3), pings.Load())
	assert.GreaterOrEqual(t, time.Since(now), retryBaseDelay+2*retryBaseDelay,
		"recovery must wait out the backoff between attempts")
}

func TestConnectWithRetryExhaustsBudgetAndReturnsLastError(t *testing.T) {
	wantErr := errors.New("still down")
	var pings atomic.Int32
	err := connectWithRetry(context.Background(), func(ctx context.Context, _ *mongo.Client) error {
		pings.Add(1)
		return wantErr
	}, nil)

	assert.ErrorIs(t, err, wantErr)
	assert.Equal(t, int32(connectRetries), pings.Load())
}

func TestConnectWithRetryStopsOnCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var pings atomic.Int32
	err := connectWithRetry(ctx, func(ctx context.Context, _ *mongo.Client) error {
		pings.Add(1)
		cancel()
		return errors.New("connection refused")
	}, nil)

	assert.ErrorIs(t, err, context.Canceled)
	assert.Less(t, pings.Load(), int32(connectRetries), "cancellation must abort mid-retry")
}

func TestConnectWithRetryCancelledBeforeStart(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	var pings atomic.Int32
	err := connectWithRetry(ctx, func(ctx context.Context, _ *mongo.Client) error {
		pings.Add(1)
		return errors.New("connection refused")
	}, nil)

	assert.ErrorIs(t, err, context.Canceled)
	assert.Zero(t, pings.Load())
}
