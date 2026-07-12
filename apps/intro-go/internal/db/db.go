package db

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"time"

	"intro-go/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

// New builds a configured pgxpool against the reader database.
// If the DSN lacks an sslmode query param, cfg.DBSSLMODE is applied so the
// same env var works for both production (require) and local (disable) setups.
func New(ctx context.Context, cfg *config.Config) (*pgxpool.Pool, error) {
	dsn, err := ensureSSLMode(cfg.DatabaseReaderURL, cfg.DBSSLMODE)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse pool config: %w", err)
	}
	// The intro service issues only a couple of point reads per request; a
	// small ceiling keeps the Fargate task from over-subscribing the DB.
	poolCfg.MaxConns = 4
	poolCfg.MinConns = 0
	poolCfg.HealthCheckPeriod = time.Minute
	poolCfg.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	log.Printf("db pool ready (max_conns=%d sslmode=%s)", poolCfg.MaxConns, cfg.DBSSLMODE)
	return pool, nil
}

func ensureSSLMode(rawURL, sslmode string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	if q.Get("sslmode") == "" {
		q.Set("sslmode", sslmode)
		u.RawQuery = q.Encode()
	}
	return u.String(), nil
}
