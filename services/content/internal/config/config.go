package config

import (
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/joho/godotenv"
)

type Config struct {
	Port                 string
	MongoURI             string
	DbName               string
	RedisAddr            string
	JwtSecret            string
	JwtIssuer            string
	JwtAudience          string
	AIServiceURL         string
	KafkaBrokers         []string
	KafkaTopic           string
	KafkaConsumerGroupID string
	KafkaDLQTopic        string
	WorkerConcurrency    int
}

var loadOnce sync.Once

// LoadConfig reads configuration from the environment, falling back to a
// local .env file when present, then to sane defaults.
func LoadConfig() Config {
	loadEnvFile()

	return Config{
		Port:                 getEnv("PORT", "4002"),
		MongoURI:             getEnv("MONGO_URI", "mongodb://localhost:27017"),
		DbName:               getEnv("DB_NAME", "blog_content"),
		RedisAddr:            getEnv("REDIS_ADDR", "localhost:6379"),
		JwtSecret:            getEnv("JWT_SECRET", ""),
		JwtIssuer:            getEnv("JWT_ISSUER", "user-service"),
		JwtAudience:          getEnv("JWT_AUDIENCE", "topos"),
		AIServiceURL:         getEnv("AI_SERVICE_URL", "ai-service:50051"),
		KafkaBrokers:         splitAndTrim(getEnv("KAFKA_BROKERS", "kafka-1:9092")),
		KafkaTopic:           getEnv("KAFKA_TOPIC", "posts"),
		KafkaConsumerGroupID: getEnv("KAFKA_CONSUMER_GROUP_ID", "content-summary-worker-group"),
		KafkaDLQTopic:        getEnv("KAFKA_DLQ_TOPIC", "posts-dlq"),
		WorkerConcurrency:    getEnvInt("WORKER_CONCURRENCY", 3),
	}
}

func loadEnvFile() {
	loadOnce.Do(func() {
		_ = godotenv.Load()
	})
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func splitAndTrim(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
