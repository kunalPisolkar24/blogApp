package config

import (
	"os"
	"strings"
	"sync"

	"github.com/joho/godotenv"
)

type Config struct {
	Port string
}

var loadOnce sync.Once

// LoadConfig reads configuration from the environment, falling back to a
// local .env file when present, then to sane defaults.
func LoadConfig() Config {
	loadEnvFile()

	return Config{
		Port: getEnv("PORT", "4002"),
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
