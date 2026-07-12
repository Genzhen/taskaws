package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"time"

	"intro-go/internal/db"
	"intro-go/internal/intro"

	"github.com/jackc/pgx/v5/pgxpool"
)

type introResponse struct {
	UserID    string   `json:"userId"`
	Name      string   `json:"name"`
	AvatarURL *string  `json:"avatarUrl"`
	Intro     string   `json:"intro"`
	Sources   []string `json:"sources"`
}

type streamDone struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
	Intro  string `json:"intro"`
}

func handleHealth(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := pool.Ping(ctx); err != nil {
			log.Printf("health: db ping failed: %v", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "error": "db unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func handleIntro(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("userId")
		if userID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userId required"})
			return
		}

		user, gh, err := loadUserAndGitHub(r.Context(), pool, userID)
		if err != nil {
			log.Printf("intro: load: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		if user == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
			return
		}

		sources := []string{"user"}
		if gh != nil {
			sources = append(sources, "github")
		}

		resp := introResponse{
			UserID:  user.ID,
			Name:    user.Name,
			Intro:   intro.Generate(user, gh),
			Sources: sources,
		}
		resp.AvatarURL = pickAvatar(user, gh)

		writeJSON(w, http.StatusOK, resp)
	}
}

func handleIntroStream(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("userId")
		if userID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "userId required"})
			return
		}

		user, gh, err := loadUserAndGitHub(r.Context(), pool, userID)
		if err != nil {
			log.Printf("stream: load: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		if user == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unsupported"})
			return
		}

		h := w.Header()
		h.Set("Content-Type", "text/event-stream")
		h.Set("Cache-Control", "no-cache")
		h.Set("Connection", "keep-alive")
		h.Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)

		writeSSEEvent(w, "thinking", intro.ThinkingMessage())
		flusher.Flush()

		// Brief pause so the thinking indicator is perceptible before words arrive.
		if !sleepCtx(r, 500*time.Millisecond) {
			return
		}

		full := intro.Generate(user, gh)
		for _, word := range intro.Words(full) {
			if r.Context().Err() != nil {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", word)
			flusher.Flush()
			if !sleepCtx(r, jitterWordDelay()) {
				return
			}
		}

		payload, err := json.Marshal(streamDone{UserID: user.ID, Name: user.Name, Intro: full})
		if err != nil {
			log.Printf("stream: marshal done: %v", err)
			return
		}
		writeSSEEvent(w, "done", string(payload))
		flusher.Flush()
	}
}

// loadUserAndGitHub fetches the user and (best-effort) their GitHub profile.
// A missing GitHub profile is not an error; it just yields a user-only intro.
func loadUserAndGitHub(ctx context.Context, pool *pgxpool.Pool, userID string) (*db.User, *db.GithubProfile, error) {
	user, err := db.GetUser(ctx, pool, userID)
	if err != nil {
		return nil, nil, err
	}
	if user == nil {
		return nil, nil, nil
	}
	gh, err := db.GetGithubProfile(ctx, pool, userID)
	if err != nil {
		return nil, nil, err
	}
	return user, gh, nil
}

// pickAvatar prefers the GitHub avatar (always present when a profile exists),
// then falls back to the user image, then nil (serialized as JSON null).
func pickAvatar(user *db.User, gh *db.GithubProfile) *string {
	if gh != nil && gh.AvatarURL != "" {
		return &gh.AvatarURL
	}
	if user.Image.Valid && user.Image.String != "" {
		s := user.Image.String
		return &s
	}
	return nil
}

// jitterWordDelay returns a pseudo-random 40-70ms delay so streamed words
// arrive at a natural cadence rather than in a single burst.
func jitterWordDelay() time.Duration {
	return time.Duration(40+rand.Intn(31)) * time.Millisecond
}

// sleepCtx sleeps for d but aborts (returning false) as soon as the request
// context is cancelled, so client disconnects free the goroutine immediately.
func sleepCtx(r *http.Request, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-r.Context().Done():
		return false
	}
}

// writeSSEEvent writes a named SSE event with a single data line.
func writeSSEEvent(w http.ResponseWriter, event, data string) {
	fmt.Fprintf(w, "event: %s\n", event)
	fmt.Fprintf(w, "data: %s\n\n", data)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write json: %v", err)
	}
}
