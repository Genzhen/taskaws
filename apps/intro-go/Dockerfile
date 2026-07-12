# syntax=docker/dockerfile:1

# ---- builder ----
FROM golang:1.22-alpine AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/intro ./cmd/intro

# ---- runner ----
FROM alpine:3.20
RUN apk add --no-cache wget ca-certificates

COPY --from=builder /out/intro /intro

ENV PORT=8080 \
    DB_SSLMODE=require

EXPOSE 8080
USER nobody

ENTRYPOINT ["/intro"]
