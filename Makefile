# SPDX-License-Identifier: AGPL-3.0-only
# Common tasks. Run `make help` for the list.

SHELL := /bin/bash
GO_DIR := apps/api-go
COMPOSE ?= docker compose
export GOFLAGS ?= -p=4

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this list
	@grep -hE '^[a-z][a-z-]*:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

.PHONY: install
install: ## Install Node dependencies
	pnpm install --frozen-lockfile

.PHONY: dev
dev: install ## Run the web app on fixture data, no backend (http://127.0.0.1:3000)
	pnpm dev

.PHONY: demo
demo: ## Start the full stack with synthetic data in docker compose
	$(COMPOSE) up --build -d
	@echo "OpenDispatch is starting at http://127.0.0.1:$${OPENDISPATCH_WEB_PORT:-3000} (history and past forecasts take a few minutes)"

.PHONY: demo-logs
demo-logs: ## Follow the compose logs
	$(COMPOSE) logs -f

.PHONY: demo-down
demo-down: ## Stop the stack and delete its data volumes
	$(COMPOSE) down --volumes

.PHONY: env
env: ## Write .env with random credentials for the compose stack
	@test ! -e .env || { echo ".env exists; move it away first"; exit 1; }
	@umask 077; { \
	  echo "OPENDISPATCH_OWNER_DB_PASSWORD=$$(openssl rand -hex 24)"; \
	  echo "OPENDISPATCH_APP_DB_PASSWORD=$$(openssl rand -hex 24)"; \
	  echo "DEMO_SESSION_SECRET=$$(openssl rand -hex 32)"; \
	  echo "FEED_SIM_SECRET=$$(openssl rand -hex 32)"; \
	  echo "OPENDISPATCH_S3_ACCESS_KEY=$$(openssl rand -hex 10)"; \
	  echo "OPENDISPATCH_S3_SECRET_KEY=$$(openssl rand -hex 24)"; \
	} > .env
	@echo "wrote .env (docker compose reads it automatically)"

.PHONY: test
test: test-node test-go test-engines ## Run all unit tests

.PHONY: test-node
test-node: ## Web and tooling unit tests (vitest)
	pnpm test:pure

.PHONY: test-go
test-go: ## Go unit tests (tests that need PostgreSQL skip without OPENDISPATCH_TEST_DATABASE_URL)
	cd $(GO_DIR) && go test ./...
	cd tools/loadgen && go test ./...

.PHONY: test-engines
test-engines: ## Python engine tests
	cd engines && python -m pytest -q

.PHONY: lint
lint: ## ESLint, Stylelint, type check, gofmt, go vet, contracts
	pnpm lint
	pnpm lint:css
	pnpm typecheck
	pnpm validate:contracts
	@out="$$(gofmt -l $(GO_DIR) tools/loadgen)"; test -z "$$out" || { echo "gofmt needed:"; echo "$$out"; exit 1; }
	cd $(GO_DIR) && go vet ./...

.PHONY: fixtures
fixtures: ## Regenerate the synthetic fixtures and check them
	pnpm generate:fixtures
	pnpm validate:fixtures
	pnpm calibration:check

.PHONY: map
map: ## Fetch the basemap extract for local development (needs the pmtiles CLI)
	sh scripts/fetch-map.sh
