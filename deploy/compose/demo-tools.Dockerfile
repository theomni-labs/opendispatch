# SPDX-License-Identifier: AGPL-3.0-only
# The demo tools: seed the database from the synthetic fixtures, run the feeds simulator,
# build the synthetic history and the past forecasts. Build from the repository root.
FROM golang:1.27 AS build
WORKDIR /src/apps/api-go
COPY apps/api-go/go.mod apps/api-go/go.sum ./
RUN go mod download
COPY apps/api-go/ ./
RUN for c in demoseed demohistory demoforecasts feedsim; do \
      CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/$c ./cmd/$c || exit 1; \
    done

FROM node:25-slim
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
RUN echo '{"private":true,"type":"module","dependencies":{"postgres":"3.4.9","tsx":"4.23.13"}}' > package.json \
 && npm install --no-audit --no-fund && chown -R node:node /repo
COPY --from=build /out/ /usr/local/bin/
COPY pnpm-workspace.yaml ./
COPY config ./config
COPY fixtures ./fixtures
COPY scripts/db ./scripts/db
COPY scripts/synthetic/calibration.json ./scripts/synthetic/calibration.json
COPY scripts/demo ./scripts/demo
COPY deploy/compose/demo-setup.sh /usr/local/bin/demo-setup
RUN mkdir -p /state && chown node:node /state
ENV PATH=/repo/node_modules/.bin:$PATH OPENDISPATCH_FIXTURES_DIR=/repo/fixtures
USER node
ENTRYPOINT ["demo-setup"]
