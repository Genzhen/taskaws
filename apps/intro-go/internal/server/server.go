package server

import (
	"log"
	"net/http"
	"time"

	"intro-go/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

// New wires up routes and middleware into a single http.Handler.
func New(cfg *config.Config, pool *pgxpool.Pool) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", handleHealth(pool))
	mux.HandleFunc("GET /api/intro", handleIntro(pool))
	mux.HandleFunc("GET /api/intro/stream", handleIntroStream(pool))

	// Order: logging (outermost) -> cors -> mux. CORS sits inside logging so
	// the access log records the final status of every request, including
	// short-circuited OPTIONS preflight responses.
	var h http.Handler = mux
	h = withCORS(cfg.CORSOrigin)(h)
	h = withLogging(h)
	return h
}

// withCORS injects permissive CORS headers. With no CORS_ORIGIN the service
// falls back to "*", which is fine because we never send credentials.
func withCORS(origin string) func(http.Handler) http.Handler {
	allow := origin
	if allow == "" {
		allow = "*"
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", allow)
			h.Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Vary", "Origin")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// withLogging records method, path, status, and duration for each request.
func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.RequestURI(), rec.status, time.Since(start))
	})
}

// statusRecorder captures the response status. It also forwards Flush so the
// SSE handler can stream even when wrapped by the logging middleware.
type statusRecorder struct {
	http.ResponseWriter
	status    int
	wroteHead bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.wroteHead {
		return
	}
	s.status = code
	s.wroteHead = true
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
