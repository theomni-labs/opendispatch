# Getting started

Two ways to run OpenDispatch: the whole stack in Docker Compose (the quickest way to evaluate it), or each part
from source (for development). Both use synthetic data only.

## Run the full stack with Docker Compose

You need Docker with Compose v2. Nothing else is installed on the host.

```sh
make env                  # optional: writes .env with random credentials
docker compose up --build
```

Then open <http://127.0.0.1:3000/en> (or `/ar` for Arabic, right to left). In the demo you sign in by picking a
role on the sign-in screen; there are no passwords.

Without `make env`, `docker-compose.yml` uses development defaults for every credential. They are fine on your own
machine and nowhere else. Copy `.env.example` to `.env` and fill it in, or run `make env`, before the stack is
reachable by anyone but you. Only the web app is published, and only on `127.0.0.1`.

### What starts

| Service | What it does |
|---|---|
| `postgres` | PostgreSQL 16 with TimescaleDB (the Apache-2.0 `-oss` build). Creates the application role on first start |
| `s3` | SeaweedFS, an S3-compatible store for uploaded import files |
| `forecaster`, `optimizer`, `simulator`, `assignment` | The four Python engines, one container each, same image |
| `api` | The Go api. Applies migrations at start, then serves `/api/v1` on port 8081 inside the network |
| `seed` | One-shot: loads the synthetic fixtures once the api is ready |
| `feeds` | The feeds simulator: replays the synthetic day shifted to end now, then keeps sending cases at the day's pace |
| `history` | One-shot: vehicles and positions, a sample classification rule, and 52 weeks of synthetic case history |
| `backfill` | One-shot: 14 past forecasts, each made as of its own day, so the accuracy screens have something to show |
| `worker` | The scheduler: builds rosters, makes forecasts, measures accuracy, every 300 seconds |
| `web` | The Next.js web app on `127.0.0.1:3000` |
| `ollama` | Optional, profile `assistant`: a local model for the AI assistant |

The one-shot steps live in `deploy/compose/demo-setup.sh` and run from the `demo-tools` image
(`deploy/compose/demo-tools.Dockerfile`). The first start takes a while: the images build, then the history step
writes two years of synthetic cases. Later starts skip steps that are already done.

### Adjust the demo

Set these in `.env` before `docker compose up`:

| Variable | Default | Effect |
|---|---|---|
| `OPENDISPATCH_WEB_PORT` | `3000` | Published port of the web app (always on `127.0.0.1`) |
| `OPENDISPATCH_DEMO_HISTORY_WEEKS` | `52` | Weeks of synthetic history the `history` step writes |
| `OPENDISPATCH_DEMO_PAST_FORECAST_DAYS` | `14` | Past forecasts the `backfill` step makes; `0` turns it off |
| `OPENDISPATCH_DEMO_FEED_SPEED` | `1` | Speed of the feeds simulator |
| `OPENDISPATCH_FETCH_MAP` | `1` | `0` builds the web image without downloading the basemap (offline builds; the map then has no tiles) |

### Start again from scratch

```sh
docker compose down -v    # removes the database, object store and demo-state volumes
docker compose up --build
```

### Turn on the AI assistant (optional)

The assistant is off by default. To run it on a local model with Ollama:

```sh
OPENDISPATCH_ASSISTANT_PROVIDER=ollama docker compose --profile assistant up --build
docker compose exec ollama ollama pull qwen2.5:7b-instruct   # once; the model then works offline
```

To use any OpenAI-compatible endpoint instead, set `OPENDISPATCH_ASSISTANT_PROVIDER=openai`,
`OPENDISPATCH_ASSISTANT_OPENAI_URL`, `OPENDISPATCH_ASSISTANT_MODEL` and, if the endpoint needs one,
`OPENDISPATCH_ASSISTANT_API_KEY`. See [configuration](configuration.md#ai-assistant). The assistant explains, drafts
and summarises; it never produces a forecast, a roster or an assignment.

## Run from source

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | 22.13 or later |
| pnpm | 10.12.1 (`corepack enable`) |
| Go | 1.27 |
| Python | 3.12 |
| PostgreSQL | 16, TimescaleDB optional (without it `forecast_values` stays a plain table) |

An S3-compatible store is needed only for case imports.

### Make targets

| Target | What it runs |
|---|---|
| `make env` | Writes `.env` with random credentials |
| `make dev` | The development servers |
| `make test` | The test suites |
| `make lint` | Linters and formatters in check mode |
| `make demo` | The Compose demo stack |

The commands below are what those targets wrap, so you can run one part at a time.

### Database

Create a database, an owner role and an application role. The application role must not bypass row-level security.
`deploy/compose/postgres-init.sh` shows the grants:

```sql
CREATE ROLE opendispatch_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO opendispatch_app;
ALTER DEFAULT PRIVILEGES FOR ROLE opendispatch_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO opendispatch_app;
```

### Engines

```sh
cd engines
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements/base.txt && pip install -e '.[dev]'
OPENDISPATCH_ENGINE=forecaster OPENDISPATCH_ENGINE_ADDR=127.0.0.1:8090 \
OPENDISPATCH_CONTRACTS_DIR=../contracts/engines python -m opendispatch_engines.server
```

Start one process per engine on its own port. The api can also run without them: with `OPENDISPATCH_ENGINE_MODE`
unset it answers from the committed fixtures in `fixtures/engines/`.

### api and worker

```sh
cd apps/api-go
export OPENDISPATCH_AUTH_MODE=demo
export OPENDISPATCH_APP_DATABASE_URL=postgres://opendispatch_app:...@127.0.0.1:5432/opendispatch_demo
export OPENDISPATCH_OWNER_DATABASE_URL=postgres://opendispatch_owner:...@127.0.0.1:5432/opendispatch_demo
export DEMO_SESSION_SECRET=$(openssl rand -hex 32)
go run ./cmd/api          # migrates, then listens on :8081
```

Load the fixtures (from the repository root, with the api running):

```sh
pnpm install
OPENDISPATCH_MIGRATION_DATABASE_URL=$OPENDISPATCH_OWNER_DATABASE_URL pnpm seed:postgres -- --reset
```

The worker needs the application role and the tenant to plan for (the fixtures' tenant is in
`fixtures/manifest.json`):

```sh
OPENDISPATCH_TENANT_ID=8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55 go run ./cmd/worker
```

### Web app

```sh
OPENDISPATCH_API_URL=http://127.0.0.1:8081 DEMO_SESSION_SECRET=<same as the api> pnpm dev
```

### Tests

```sh
pnpm test:pure                                  # TypeScript unit tests
pnpm typecheck && pnpm lint
(cd apps/api-go && go test ./...)               # tests that need PostgreSQL skip without OPENDISPATCH_TEST_DATABASE_URL
(cd engines && OPENDISPATCH_CONTRACTS_DIR=../contracts/engines pytest)
pnpm validate:contracts && pnpm validate:fixtures
```

Browser tests use Playwright: `pnpm e2e:flows` and the other `e2e:*` scripts in `package.json`.

## Next

- [Architecture](architecture.md) for how the pieces fit.
- [Configuration](configuration.md) for every setting.
- [Deployment](deployment.md) to run it on a cluster.
