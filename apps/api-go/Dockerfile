# SPDX-License-Identifier: AGPL-3.0-only
# Build from the repository root: docker build -f apps/api-go/Dockerfile --target api .
FROM golang:1.27 AS build
WORKDIR /src/apps/api-go
COPY apps/api-go/go.mod apps/api-go/go.sum ./
RUN go mod download
COPY apps/api-go/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/bootstrap ./cmd/bootstrap

FROM gcr.io/distroless/static-debian12 AS base
WORKDIR /app
COPY pnpm-workspace.yaml ./
COPY apps/api-go/migrations ./migrations
COPY config ./config
COPY fixtures ./fixtures
ENV OPENDISPATCH_MIGRATIONS_DIR=/app/migrations \
    OPENDISPATCH_FIXTURES_DIR=/app/fixtures
USER 65532:65532

FROM base AS api
COPY --from=build /out/api /app/api
# Migration job entrypoint (owner role only)
COPY --from=build /out/migrate /app/migrate
# First-run job entrypoint (application role)
COPY --from=build /out/bootstrap /app/bootstrap
ENV OPENDISPATCH_LISTEN_ADDR=:8081
EXPOSE 8081
ENTRYPOINT ["/app/api"]

FROM base AS worker
COPY --from=build /out/worker /app/worker
ENV OPENDISPATCH_WORKER_HEALTH_ADDR=:8082
EXPOSE 8082
ENTRYPOINT ["/app/worker"]
