# intro-go

A small Go HTTP microservice that generates a short self-introduction for a
user, optionally enriched with their synced GitHub profile. Backs the
`/api/intro` and `/api/intro/stream` endpoints consumed by the TaskAWS web app.

- stdlib `net/http` with Go 1.22+ `ServeMux` method routing (no framework)
- `pgx`/`pgxpool` against the shared Postgres reader
- JSON and Server-Sent Events (SSE) responses
- graceful shutdown on SIGINT / SIGTERM

## Run locally

```bash
cp .env.example .env  # then fill DATABASE_READER_URL
export $(grep -v '^#' .env | xargs)
go run ./cmd/intro
# -> intro-go listening on :8080
```

Quick checks:

```bash
curl 'http://localhost:8080/health'
curl 'http://localhost:8080/api/intro?userId=<id>'
curl -N 'http://localhost:8080/api/intro/stream?userId=<id>'
```

## Docker

```bash
docker build -t intro-go .
docker run --rm -p 8080:8080 \
  -e DATABASE_READER_URL='postgresql://...' \
  -e CORS_ORIGIN='http://localhost:3001' \
  intro-go
```

## Test

```bash
go test ./...
```

## Environment variables

| Variable              | Required | Default   | Notes |
|-----------------------|----------|-----------|-------|
| `DATABASE_READER_URL` | yes      |           | Postgres DSN; sslmode auto-applied from `DB_SSLMODE` when absent |
| `PORT`                | no       | `8080`    | HTTP listen port |
| `CORS_ORIGIN`         | no       | `*`       | Value of `Access-Control-Allow-Origin` |
| `DB_SSLMODE`          | no       | `require` | `require` = TLS without cert verify; use `disable` locally |

## API contract

| Method & path                       | Description |
|-------------------------------------|-------------|
| `GET /health`                       | `200 {"status":"ok"}` (pings DB) |
| `GET /api/intro?userId=<id>`        | JSON intro; `400` if no userId, `404` if user not found |
| `GET /api/intro/stream?userId=<id>` | `text/event-stream`: `thinking` event, one `data:` per word, then `done` event with JSON |
