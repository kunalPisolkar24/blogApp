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

	// HTTPPanicsTotal counts panics recovered by RecoverMiddleware.
	HTTPPanicsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "content",
		Subsystem: "http",
		Name:      "panics_total",
		Help:      "Panics recovered in the HTTP handler chain.",
	})

	// GraphQLErrorsTotal counts GraphQL operation failures by operation
	// and error kind (unauthorized, forbidden, not_found, validation,
	// client, internal). HTTP-level alerting on 5xx cannot see these,
	// because GraphQL responses ride on HTTP 200.
	GraphQLErrorsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "content",
		Subsystem: "graphql",
		Name:      "errors_total",
		Help:      "GraphQL operation failures, by operation and error kind.",
	}, []string{"operation", "kind"})

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

	// CacheErrorsTotal counts Redis command failures the cache swallowed.
	// Graceful degradation is by design, but a dying Redis must be
	// visible in metrics, not just in debug logs.
	CacheErrorsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "content",
		Name:      "cache_errors_total",
		Help:      "Redis cache command failures, swallowed by the degrading cache.",
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

	// RecommendColdStartTotal counts feed requests served from the recency
	// fallback because the AI returned an empty result for a user with no
	// interaction profile yet. Degraded calls (AI failure or open breaker)
	// are counted by AIFallbackEngaged instead.
	RecommendColdStartTotal = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "content",
		Subsystem: "recommend",
		Name:      "cold_start_total",
		Help:      "Feed requests served from the recency fallback on cold start.",
	})

	// RecommendFeedServedTotal counts recommendation feed responses by
	// mode (default, surprise). The denominator for the engagement ratio
	// (interactions after a feed / feeds served).
	RecommendFeedServedTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "content",
		Subsystem: "recommend",
		Name:      "feed_served_total",
		Help:      "Recommendation feed responses served, by mode.",
	}, []string{"mode"})

	// RecommendFeedInteractionTotal counts interactions (view, like, save)
	// that followed a recommendation feed, by feed mode and interaction
	// kind. Interactions without a feed attribution (opened directly, or
	// from a non-recommended list) are not counted, keeping the per-mode
	// ratio clean.
	RecommendFeedInteractionTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "content",
		Subsystem: "recommend",
		Name:      "feed_interaction_total",
		Help:      "Interactions on recommended posts, by feed mode and kind.",
	}, []string{"mode", "kind"})

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

	// InteractionsTotal counts user interactions by kind and outcome.
	// Statuses: published, publish_failed, deduplicated, removed, error.
	InteractionsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "content",
		Name:      "interactions_total",
		Help:      "User interactions, by kind (view, like, save) and outcome.",
	}, []string{"kind", "status"})

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
