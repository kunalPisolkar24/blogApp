package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadConfigDefaults(t *testing.T) {
	cfg := LoadConfig()

	assert.Equal(t, "4002", cfg.Port)
	assert.Equal(t, "mongodb://localhost:27017", cfg.MongoURI)
	assert.Equal(t, "blog_content", cfg.DbName)
	assert.Equal(t, "localhost:6379", cfg.RedisAddr)
	assert.Equal(t, "", cfg.JwtSecret)
	assert.Equal(t, "user-service", cfg.JwtIssuer)
	assert.Equal(t, "topos", cfg.JwtAudience)
	assert.Equal(t, []string{"kafka-1:9092"}, cfg.KafkaBrokers)
	assert.Equal(t, "posts", cfg.KafkaTopic)
	assert.Equal(t, "user-interacted", cfg.KafkaUserInteractedTopic)
	assert.Equal(t, "content-summary-worker-group", cfg.KafkaConsumerGroupID)
	assert.Equal(t, "posts-dlq", cfg.KafkaDLQTopic)
	assert.Equal(t, 3, cfg.WorkerConcurrency)
	assert.Equal(t, "json", cfg.LogFormat)
	assert.Equal(t, "info", cfg.LogLevel)
	assert.Equal(t, "", cfg.OtelEndpoint)
}

func TestLoadConfigFromEnv(t *testing.T) {
	t.Setenv("PORT", "5000")
	t.Setenv("MONGO_URI", "mongodb://mongo:27017")
	t.Setenv("DB_NAME", "test_db")
	t.Setenv("REDIS_ADDR", "redis:6380")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("JWT_ISSUER", "issuer")
	t.Setenv("JWT_AUDIENCE", "audience")
	t.Setenv("AI_SERVICE_URL", "ai:50051")
	t.Setenv("KAFKA_BROKERS", "kafka-1:9092, kafka-2:9092,  ")
	t.Setenv("KAFKA_TOPIC", "events")
	t.Setenv("KAFKA_USER_INTERACTED_TOPIC", "interactions")
	t.Setenv("KAFKA_CONSUMER_GROUP_ID", "group")
	t.Setenv("KAFKA_DLQ_TOPIC", "dlq")
	t.Setenv("WORKER_CONCURRENCY", "7")
	t.Setenv("LOG_FORMAT", "text")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "collector:4317")

	cfg := LoadConfig()

	assert.Equal(t, "5000", cfg.Port)
	assert.Equal(t, "mongodb://mongo:27017", cfg.MongoURI)
	assert.Equal(t, "test_db", cfg.DbName)
	assert.Equal(t, "redis:6380", cfg.RedisAddr)
	assert.Equal(t, "secret", cfg.JwtSecret)
	assert.Equal(t, "issuer", cfg.JwtIssuer)
	assert.Equal(t, "audience", cfg.JwtAudience)
	assert.Equal(t, "ai:50051", cfg.AIServiceURL)
	assert.Equal(t, []string{"kafka-1:9092", "kafka-2:9092"}, cfg.KafkaBrokers)
	assert.Equal(t, "events", cfg.KafkaTopic)
	assert.Equal(t, "interactions", cfg.KafkaUserInteractedTopic)
	assert.Equal(t, "group", cfg.KafkaConsumerGroupID)
	assert.Equal(t, "dlq", cfg.KafkaDLQTopic)
	assert.Equal(t, 7, cfg.WorkerConcurrency)
	assert.Equal(t, "text", cfg.LogFormat)
	assert.Equal(t, "debug", cfg.LogLevel)
	assert.Equal(t, "collector:4317", cfg.OtelEndpoint)
}

func TestGetEnvIgnoresBlankValues(t *testing.T) {
	t.Setenv("PORT", "   ")

	assert.Equal(t, "4002", getEnv("PORT", "4002"))
}

func TestGetEnvInt(t *testing.T) {
	t.Setenv("WORKER_CONCURRENCY", "4")
	assert.Equal(t, 4, getEnvInt("WORKER_CONCURRENCY", 3))

	t.Setenv("WORKER_CONCURRENCY", "abc")
	assert.Equal(t, 3, getEnvInt("WORKER_CONCURRENCY", 3))

	t.Setenv("WORKER_CONCURRENCY", "0")
	assert.Equal(t, 3, getEnvInt("WORKER_CONCURRENCY", 3))
}

func TestSplitAndTrim(t *testing.T) {
	require.Equal(t, []string{"a", "b"}, splitAndTrim("a,b"))
	require.Equal(t, []string{"a", "b"}, splitAndTrim(" a , b "))
	require.Empty(t, splitAndTrim(" , "))
	require.Empty(t, splitAndTrim(""))
}
