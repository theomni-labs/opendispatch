# SPDX-License-Identifier: AGPL-3.0-only
# Build from the repository root: docker build -f apps/web/Dockerfile .
# The basemap is fetched at build time (OPENDISPATCH_FETCH_MAP=0 skips it; the map then shows no basemap).

FROM golang:1.27 AS map
ARG OPENDISPATCH_FETCH_MAP=1
ARG OPENDISPATCH_MAP_BUILD=
WORKDIR /map
COPY scripts/fetch-map.sh ./
RUN mkdir -p out && if [ "$OPENDISPATCH_FETCH_MAP" = 1 ]; then \
      GOBIN=/usr/local/bin go install github.com/protomaps/go-pmtiles@v1.31.2 \
      && OPENDISPATCH_MAP_BUILD="$OPENDISPATCH_MAP_BUILD" sh fetch-map.sh out/saudi.pmtiles \
      || echo "basemap not fetched: the map shows no basemap"; \
    fi

FROM node:25-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @opendispatch/web build

FROM node:25-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
COPY --from=map /map/out/ ./apps/web/public/maps/
COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
# Writable paths at runtime: /tmp and the Next cache.
RUN mkdir -p /app/apps/web/.next/cache && chown -R 65532:65532 /app/apps/web/.next/cache
WORKDIR /app/apps/web
USER 65532:65532
EXPOSE 3000
CMD ["node", "server.js"]
