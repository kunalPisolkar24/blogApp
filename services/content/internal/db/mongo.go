package db

import (
	"context"
	"log/slog"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
	"go.opentelemetry.io/contrib/instrumentation/go.mongodb.org/mongo-driver/mongo/otelmongo"
)

const (
	pingTimeout = 5 * time.Second

	// connectRetries budgets the startup retry loop. Backoff is
	// 1s, 2s, 4s, 8s, 16s — about 31s of waiting before giving up.
	connectRetries = 5
	retryBaseDelay = time.Second
)

// Connect dials mongo and verifies the connection with a ping. A bad
// URI fails immediately (permanent error); a transient ping failure is
// retried with exponential backoff, respecting ctx cancellation, so a
// single startup blip does not kill the process outside orchestration.
// The client is wired into the active tracer provider, which is a no-op
// unless tracing was enabled at startup.
func Connect(ctx context.Context, uri string) (*mongo.Client, error) {
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri).SetMonitor(otelmongo.NewMonitor()))
	if err != nil {
		return nil, err
	}

	if err := connectWithRetry(ctx, ping, client); err != nil {
		_ = client.Disconnect(ctx)
		return nil, err
	}
	return client, nil
}

// ping verifies the client can reach the cluster.
func ping(ctx context.Context, client *mongo.Client) error {
	pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()
	return client.Ping(pingCtx, readpref.Primary())
}

// connectWithRetry pings until it succeeds, the retry budget is
// exhausted, or ctx is cancelled. Between attempts it sleeps with
// exponential backoff (1s, 2s, 4s, 8s, 16s), logging each warning.
func connectWithRetry(ctx context.Context, pingFn func(context.Context, *mongo.Client) error, client *mongo.Client) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}

	var err error
	delay := retryBaseDelay

	for attempt := 1; attempt <= connectRetries; attempt++ {
		if err = pingFn(ctx, client); err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if attempt == connectRetries {
			break
		}

		slog.Warn("mongo ping failed, retrying",
			"attempt", attempt, "max", connectRetries, "backoff", delay, "error", err)

		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return ctx.Err()
		}
		delay *= 2
	}

	return err
}
