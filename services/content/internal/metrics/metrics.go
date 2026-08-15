// Package metrics exposes Prometheus collectors used by both the API
// server and the worker. Collectors are registered on the default
// registry, which is served on /metrics by each process.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// HTTPRequestsTotal counts handled requests by route and status
	// class (2xx, 4xx, 5xx).
	HTTPRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "content",
		Subsystem: "http",
		Name:      "requests_total",
		Help:      "HTTP requests handled, by route and status class.",
	}, []string{"route", "status"})

	// HTTPRequestDuration measures request latency by route.
	HTTPRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "content",
		Subsystem: "http",
		Name:      "request_duration_seconds",
		Help:      "HTTP request latency in seconds, by route.",
		Buckets:   prometheus.DefBuckets,
	}, []string{"route"})

	// CacheHits counts reads served from redis.
	CacheHits = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "content",
		Name:      "cache_hits_total",
		Help:      "Cache reads served from redis.",
	})

	// CacheMisses counts reads that fell through to the database.
	CacheMisses = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "content",
		Name:      "cache_misses_total",
		Help:      "Cache reads that missed and hit the database.",
	})

	// AIFallbackEngaged counts AI calls served from the degraded path:
	// fallback results returned, or errors surfaced because the primary
	// failed or its circuit breaker was open, by operation.
	AIFallbackEngaged = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "content",
		Subsystem: "ai",
		Name:      "fallback_engaged_total",
		Help:      "AI calls served from the degraded path, by operation.",
	}, []string{"operation"})

	// AIBreakerState reports the circuit breaker state per failure
	// domain: 0 = closed, 1 = open, 2 = half-open.
	AIBreakerState = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "content",
		Subsystem: "ai",
		Name:      "breaker_state",
		Help:      "AI circuit breaker state per domain (0 closed, 1 open, 2 half-open).",
	}, []string{"domain"})

	// PostsCreated, PostsUpdated, PostsDeleted count post mutations.
	PostsCreated = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "content",
		Name:      "posts_created_total",
		Help:      "Posts created.",
	})
	PostsUpdated = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "content",
		Name:      "posts_updated_total",
		Help:      "Posts updated.",
	})
	PostsDeleted = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "content",
		Name:      "posts_deleted_total",
		Help:      "Posts deleted.",
	})

	// WorkerMessagesTotal counts consumed events by outcome.
	WorkerMessagesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "content",
		Subsystem: "worker",
		Name:      "messages_total",
		Help:      "Kafka events processed, by outcome (completed, skipped, failed, dlq).",
	}, []string{"result"})

	// WorkerRetriesTotal counts retry attempts after a failed message.
	WorkerRetriesTotal = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "content",
		Subsystem: "worker",
		Name:      "retries_total",
		Help:      "Retry attempts after a failed message.",
	})

	// WorkerLag reports the uncommitted message backlog per reader.
	WorkerLag = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "content",
		Subsystem: "worker",
		Name:      "consumer_lag",
		Help:      "Uncommitted messages per reader, from kafka-go stats.",
	}, []string{"reader"})
)
