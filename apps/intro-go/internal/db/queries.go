package db

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// User mirrors the columns read from the "user" table.
// Image is nullable in the schema, hence sql.NullString.
type User struct {
	ID        string
	Name      string
	Email     string
	Image     sql.NullString
	CreatedAt time.Time
}

// GithubProfile mirrors the columns read from github_profiles.
type GithubProfile struct {
	UserID      string
	Username    string
	Bio         sql.NullString
	PublicRepos int32
	AvatarURL   string
}

// GetUser fetches a single user by id. Returns (nil, nil) when the row does
// not exist so callers can distinguish not-found from real errors.
func GetUser(ctx context.Context, pool *pgxpool.Pool, id string) (*User, error) {
	// "user" is a Postgres reserved word and must be double-quoted.
	const q = `SELECT id, name, email, image, created_at FROM "user" WHERE id = $1`

	var u User
	err := pool.QueryRow(ctx, q, id).Scan(&u.ID, &u.Name, &u.Email, &u.Image, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetGithubProfile fetches the github profile for a user. Returns (nil, nil)
// when no profile has been synced yet.
func GetGithubProfile(ctx context.Context, pool *pgxpool.Pool, userID string) (*GithubProfile, error) {
	const q = `SELECT user_id, username, bio, public_repos, avatar_url FROM github_profiles WHERE user_id = $1`

	var g GithubProfile
	err := pool.
		QueryRow(ctx, q, userID).
		Scan(&g.UserID, &g.Username, &g.Bio, &g.PublicRepos, &g.AvatarURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}
