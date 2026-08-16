package metrics

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCollectorsRegistered(t *testing.T) {
	HTTPRequestsTotal.WithLabelValues("/query", "2xx").Inc()
	HTTPRequestDuration.WithLabelValues("/query").Observe(0.01)
	InteractionsTotal.WithLabelValues("view", "published").Inc()
	WorkerMessagesTotal.WithLabelValues("completed").Inc()
	WorkerLag.WithLabelValues("0").Set(1)

	families, err := prometheus.DefaultGatherer.Gather()
	require.NoError(t, err)

	var names []string
	for _, family := range families {
		names = append(names, family.GetName())
	}
	joined := strings.Join(names, " ")

	for _, want := range []string{
		"content_http_requests_total",
		"content_http_request_duration_seconds",
		"content_cache_hits_total",
		"content_cache_misses_total",
		"content_posts_created_total",
		"content_posts_updated_total",
		"content_posts_deleted_total",
		"content_interactions_total",
		"content_worker_messages_total",
		"content_worker_retries_total",
		"content_worker_consumer_lag",
	} {
		require.Contains(t, joined, want, "expected collector %q to be registered", want)
	}
}

func TestWorkerMetricsRecord(t *testing.T) {
	WorkerMessagesTotal.WithLabelValues("skipped").Inc()
	WorkerRetriesTotal.Inc()
	WorkerLag.WithLabelValues("0").Set(42)

	assert.Equal(t, float64(1), testutil.ToFloat64(WorkerMessagesTotal.WithLabelValues("skipped")))
	assert.Equal(t, float64(1), testutil.ToFloat64(WorkerRetriesTotal))
	assert.Equal(t, float64(42), testutil.ToFloat64(WorkerLag.WithLabelValues("0")))
}

func TestInteractionMetricsRecord(t *testing.T) {
	InteractionsTotal.WithLabelValues("save", "published").Inc()
	InteractionsTotal.WithLabelValues("like", "removed").Inc()
	InteractionsTotal.WithLabelValues("view", "publish_failed").Inc()

	assert.Equal(t, float64(1), testutil.ToFloat64(InteractionsTotal.WithLabelValues("save", "published")))
	assert.Equal(t, float64(1), testutil.ToFloat64(InteractionsTotal.WithLabelValues("like", "removed")))
	assert.Equal(t, float64(1), testutil.ToFloat64(InteractionsTotal.WithLabelValues("view", "publish_failed")))
}
