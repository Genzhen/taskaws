package config

import (
	"fmt"
	"log"
	"os"
)

// Config holds runtime configuration loaded from the environment.
type Config struct {
	DatabaseReaderURL string
	Port              string
	CORSOrigin        string
	// DBSSLMODE is appended to the DSN when it does not already specify sslmode.
	// pgx "require" = TLS without cert verification (mirrors node's rejectUnauthorized:false).
	DBSSLMODE string
}

func Load() (*Config, error) {
	cfg := &Config{
		DatabaseReaderURL: os.Getenv("DATABASE_READER_URL"),
		Port:              getEnvOrDefault("PORT", "8080"),
		CORSOrigin:        os.Getenv("CORS_ORIGIN"),
		DBSSLMODE:         getEnvOrDefault("DB_SSLMODE", "require"),
	}

	if cfg.DatabaseReaderURL == "" {
		return nil, fmt.Errorf("DATABASE_READER_URL is required")
	}

	log.Printf(
		"config loaded: port=%s sslmode=%s cors_origin=%q",
		cfg.Port, cfg.DBSSLMODE, cfg.CORSOrigin,
	)
	return cfg, nil
}

func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
