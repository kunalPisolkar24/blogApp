# syntax=docker/dockerfile:1.7

ARG GIT_REVISION=unknown

# --- Build stage: dependencies cached separately from source ---
FROM golang:1.25-alpine AS builder
WORKDIR /app

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath -ldflags="-s -w" \
    -o /out/content-service ./cmd/server

# --- Runtime stage: minimal image, non-root user ---
FROM alpine:3.20 AS runtime
ARG GIT_REVISION
LABEL org.opencontainers.image.title="topos-content" \
      org.opencontainers.image.source="https://github.com/kunalPisolkar24/topos" \
      org.opencontainers.image.revision="${GIT_REVISION}" \
      org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache tini curl ca-certificates \
    && addgroup -g 1000 appuser \
    && adduser -u 1000 -G appuser -D appuser

WORKDIR /app
COPY --from=builder --chown=appuser:appuser /out/content-service ./

USER appuser
EXPOSE 4002
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./content-service"]
