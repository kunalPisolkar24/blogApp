package config

import (
	"errors"
	"os"
	"strings"
	"sync"

	"github.com/joho/godotenv"
)

type Config struct {
	Port        string
	MongoURI    string
	DbName      string
	JwtSecret   string
	JwtIssuer   string
	JwtAudience string
}

var loadOnce sync.Once

// LoadConfig reads configuration from the environment, falling back to a
// local .env file when present, then to sane defaults.
func LoadConfig() (Config, error) {
	loadEnvFile()

	cfg := Config{
		Port:        getEnv("PORT", "4002"),
		MongoURI:    getEnv("MONGO_URI", "mongodb://localhost:27017"),
		DbName:      getEnv("DB_NAME", "blog_content"),
		JwtSecret:   getEnv("JWT_SECRET", ""),
		JwtIssuer:   getEnv("JWT_ISSUER", "user-service"),
		JwtAudience: getEnv("JWT_AUDIENCE", "topos"),
	}

	if cfg.JwtSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}

	return cfg, nil
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
