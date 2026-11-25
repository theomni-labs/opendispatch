# Configuration

All configuration comes from environment variables. Nothing secret belongs in a file in the repository, an image or
a values file: pass secrets from a secret store (a Kubernetes Secret on a cluster, `.env` for the local Compose
stack). `.env.example` lists the variables the Compose stack reads.

"Secret" in the tables below means the value must come from a secret store and is never logged.

## Compose stack

Read by `docker-compose.yml` and passed on to the services.

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_OWNER_DB_PASSWORD` | `dev-owner-password` | Password of the database owner role. Secret |
| `OPENDISPATCH_APP_DB_PASSWORD` | `dev-app-password` | Password of the application role. Secret |
| `DEMO_SESSION_SECRET` | a development value | Signs the demo session cookie; api, web and feeds simulator must agree. Secret |
| `FEED_SIM_SECRET` | a development value | Signing secret of the demo feed key in `deploy/compose/feed-keys.json`. Secret |
| `OPENDISPATCH_S3_ACCESS_KEY`, `OPENDISPATCH_S3_SECRET_KEY` | development values | Credentials of the SeaweedFS store and of the api. Secret |
| `OPENDISPATCH_WEB_PORT` | `3000` | Published port of the web app, on `127.0.0.1` |
| `OPENDISPATCH_DEMO_HISTORY_WEEKS` | `52` | Weeks of synthetic history the `history` step writes |
| `OPENDISPATCH_DEMO_PAST_FORECAST_DAYS` | `14` | Past forecasts the `backfill` step makes; `0` is off |
| `OPENDISPATCH_DEMO_FEED_SPEED` | `1` | Speed of the feeds simulator |
| `OPENDISPATCH_FETCH_MAP` | `1` | Build argument of the web image: `0` skips downloading the basemap |
| `OPENDISPATCH_ASSISTANT_*` | provider `off` | Passed to the api; see [AI assistant](#ai-assistant) |

`docker-compose.yml` passes a fixed set of variables to each service. To set any other variable below, add it to that
service's `environment` in a Compose override file.

## api

`apps/api-go/cmd/api`. Image `opendispatch/api`.

### Core

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_AUTH_MODE` | none, required | `demo` (evaluation, tests) or `oidc` (installs). The api refuses to start without it |
| `OPENDISPATCH_APP_DATABASE_URL` | none, required | Application role URL, used for every request. Secret |
| `OPENDISPATCH_OWNER_DATABASE_URL` | none | Owner role URL, used only to apply migrations at start (and for test resets). Required unless `OPENDISPATCH_MIGRATE_ON_START=0`. Secret |
| `OPENDISPATCH_MIGRATE_ON_START` | `1` | `0` when a migration job applies migrations; the api then needs no owner URL |
| `OPENDISPATCH_MIGRATIONS_DIR` | `migrations` (image: `/app/migrations`) | Migration files; also read by the readiness probe |
| `OPENDISPATCH_LISTEN_ADDR` | `:8081` | Listen address |
| `OPENDISPATCH_RECORD_DATA_SOURCE` | `SYNTHETIC` | `data_source` of records made in the app: `SYNTHETIC` or `LIVE`. Anything else stops the start |
| `OPENDISPATCH_FIXTURES_DIR` | repository `fixtures/` (image: `/app/fixtures`) | Fixtures directory: engine answers in fixture mode, Hijri months, demo data |
| `OPENDISPATCH_TEST_ROUTES` | off | `1` registers `/_internal/test/*` routes that can reset the database. Demo mode only, never on an install |
| `OPENDISPATCH_CUSTOMER_SHORT_NAME`, `OPENDISPATCH_CUSTOMER_SHORT_NAME_AR` | `Customer`, `العميل` | The operator's short name in screen and server text. Arabic falls back to English |
| `OPENDISPATCH_DEMO_CUSTOMER_NAME`, `OPENDISPATCH_DEMO_CUSTOMER_NAME_AR` | `Example Response (synthetic)` and its Arabic | Tenant name shown on the demo sign-in screen |

Probes: `GET /livez` (process up) and `GET /ready` (database reachable and migrations applied), plus `GET /health`.

### Sign-in

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_OIDC_TENANTS_FILE` | none, required in oidc | JSON array of the tenants that may sign in: `tenant_id`, `issuer` (https), `client_id`, `redirect_uri`, optional `client_secret_env`, `audience`, `scopes`, `groups_claim` (default `groups`), `install_mode`, `organization`, `organization_id`. The file holds no secret: `client_secret_env` names the variable that does |
| `OPENDISPATCH_AUTH_SECRET` | none, required in oidc | Signs session cookies; at least 32 characters. Secret |
| `OPENDISPATCH_COOKIE_SECURE` | off | `1` marks session cookies `Secure` (oidc) |
| `DEMO_SESSION_SECRET` | none | Verifies the demo session cookie; sessions are refused when unset (demo). Secret |
| `DEMO_COOKIE_SECURE` | off | `1` marks the demo cookie `Secure` |
| `DEMO_EMERGENCY_ADMIN_PASSWORD`, `DEMO_EMERGENCY_ADMIN_TOTP` | unset: emergency sign-in refused | Emergency administrator sign-in. Secret |
| `OPENDISPATCH_KEYCLOAK_ADMIN_URL`, `OPENDISPATCH_KEYCLOAK_REALM`, `OPENDISPATCH_KEYCLOAK_ADMIN_CLIENT_ID`, `OPENDISPATCH_KEYCLOAK_ADMIN_CLIENT_SECRET` | unset: identity providers are stored in the database only | Service account the api uses to manage identity providers in Keycloak (Admin, Sign-in and Identity Providers). The secret is secret |

### Engines

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_ENGINE_MODE` | `fixture` | `fixture` answers from `fixtures/engines/`; `engine` calls the engine services and needs all four URLs |
| `OPENDISPATCH_ENGINE_FORECASTER_URL`, `..._OPTIMIZER_URL`, `..._SIMULATOR_URL`, `..._ASSIGNMENT_URL` | none | Base URL of each engine; the api calls `<url>/v1/<engine>` |
| `OPENDISPATCH_ENGINE_ASSIGNMENT_DEADLINE_MS` | `2000` | Per-call limit for the assignment scorer, 50 to 30000 |
| `OPENDISPATCH_ENGINE_FORECASTER_DEADLINE_MS`, `..._OPTIMIZER_DEADLINE_MS`, `..._SIMULATOR_DEADLINE_MS` | `60000` | Per-call limit, 1000 to 1800000 |
| `OPENDISPATCH_BACKTEST_TIMEOUT_MINUTES` | `20` | Limit of one background backtest, 5 to 600 |

### Object storage (imports)

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_S3_ENDPOINT` | `127.0.0.1` | Host of the S3-compatible store |
| `OPENDISPATCH_S3_PORT` | `9000` | Port |
| `OPENDISPATCH_S3_USE_SSL` | `false` | `true` for TLS |
| `OPENDISPATCH_S3_BUCKET` | `opendispatch-imports` | Bucket for uploaded import files |
| `OPENDISPATCH_S3_ACCESS_KEY`, `OPENDISPATCH_S3_SECRET_KEY` | none | Credentials. Without them imports fail with "the file storage is not available"; in oidc mode the api refuses to start. Secret |
| `OPENDISPATCH_IMPORT_MAX_BYTES` | `2147483648` (2 GiB) | Largest multipart import upload; larger gets 413 |

### Feeds and the live board

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_FEED_KEYS_FILE` | unset: feeds off | JSON array of signing keys: `key_id`, `tenant_id`, `secret_env` (the variable holding the secret), `status` (`active`, `retiring`, `revoked`), `data_source`. Setting it turns on `/feeds/v1/*` |
| `OPENDISPATCH_FEED_RETENTION_DAYS` | `30` | Days to keep processed feed events |
| `OPENDISPATCH_DISPATCH_SOURCE` | `replay` | What the live board reads: `replay` (the scripted synthetic day) or `feeds` |
| `OPENDISPATCH_BOARD_WINDOW_HOURS` | `24` | Board window with `feeds` |
| `OPENDISPATCH_FALLBACK_SILENCE_SECONDS` | `120` | Default for the tenant setting: seconds of silence on both feeds before the board falls back, 5 to 3600 (feeds only) |
| `OPENDISPATCH_FALLBACK_CHECK_SECONDS` | `15` | How often the fallback check runs (feeds only) |
| `OPENDISPATCH_UNREACHABLE_CHECK_SECONDS` | `30` | How often the unreachable-case alert runs (feeds only) |
| `OPENDISPATCH_DEMO_FEEDSIM_CONTROL` | unset | Demo mode only: file through which the outage control talks to the feeds simulator |

### Weather and traffic (api and worker)

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_WEATHER_SOURCE` | `none` | `none`, `synthetic` (a seeded synthetic series), `file` or `openmeteo` |
| `OPENDISPATCH_WEATHER_FILE` | none | CSV with columns `city,date,rain_mm,dust_event,max_temp_c,visibility_km`; required with `file`, re-read when it changes |
| `OPENDISPATCH_WEATHER_URL` | `https://api.open-meteo.com` | Forecast API base URL (`openmeteo`) |
| `OPENDISPATCH_WEATHER_ARCHIVE_URL` | `https://archive-api.open-meteo.com` | Archive API base URL (`openmeteo`) |
| `OPENDISPATCH_WEATHER_API_KEY` | none | Weather API key, sent only over https. Secret |
| `OPENDISPATCH_WEATHER_TIMEOUT_MS` | `5000` | Per-call limit, 100 to 60000 |
| `OPENDISPATCH_WEATHER_SEED` | built-in | Seed of the synthetic weather series |
| `OPENDISPATCH_TRAFFIC_SOURCE` | `none` | `none`, `synthetic` or `file` |
| `OPENDISPATCH_TRAFFIC_FILE` | none | CSV in the layout of `config/mappings/traffic/traffic_v1.json`; required with `file` |
| `OPENDISPATCH_TRAFFIC_SEED` | built-in | Seed of the synthetic traffic series |

A failing weather or traffic source never fails a forecast: the error is logged and the forecast goes without the
missing days.

### AI assistant

The assistant explains screens, answers questions about the planning data, drafts rules, scenarios and calendar
events, suggests import mappings and summarises handovers. It never produces a forecast, roster or assignment, and a
person confirms every draft.

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_ASSISTANT_PROVIDER` | `off` | `off`, `ollama` (local model, nothing leaves the install) or `openai` (any OpenAI-compatible chat endpoint) |
| `OPENDISPATCH_ASSISTANT_MODEL` | `qwen2.5:7b-instruct` with ollama; required with openai | Model name |
| `OPENDISPATCH_ASSISTANT_OLLAMA_URL` | `http://127.0.0.1:11434` (Compose: `http://ollama:11434`) | Ollama base URL |
| `OPENDISPATCH_ASSISTANT_OPENAI_URL` | none; required with openai | Base URL of the OpenAI-compatible endpoint |
| `OPENDISPATCH_ASSISTANT_API_KEY` | none | Bearer key for the openai provider, when the endpoint needs one. Never logged or sent to the browser. Secret |
| `OPENDISPATCH_ASSISTANT_VISION` | `false` | `true` when the openai model accepts images (case photos) |
| `OPENDISPATCH_ASSISTANT_TIMEOUT_SECONDS` | `240` (ollama), `120` (openai) | Per model call, 1 to 900 |

Admin, AI Assistant shows the active provider, model, whether it is offline, and the last 7 days of use.

## worker

`apps/api-go/cmd/worker`. Image `opendispatch/worker`. Run one worker per tenant.

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_APP_DATABASE_URL` | none, required | Application role URL. Secret |
| `OPENDISPATCH_TENANT_ID` | none, required | The tenant this worker plans for |
| `OPENDISPATCH_WORKER_INTERVAL_SECONDS` | `300` | Seconds between cycles |
| `OPENDISPATCH_WORKER_HEALTH_ADDR` | unset: no probes (image: `:8082`) | Address for `/livez`, `/readyz` and `/ready` |
| `OPENDISPATCH_RECORD_DATA_SOURCE` | `SYNTHETIC` | As for the api |
| `OPENDISPATCH_MIGRATIONS_DIR`, `OPENDISPATCH_FIXTURES_DIR` | as for the api | As for the api |
| `OPENDISPATCH_ENGINE_*` | as for the api | As for the api |
| Weather and traffic variables | as for the api | As for the api |
| `OPENDISPATCH_CUSTOMER_SHORT_NAME`, `_AR` | as for the api | As for the api |

## migrate

`apps/api-go/cmd/migrate`, `/app/migrate` in the api image. The migration job on a cluster.

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_OWNER_DATABASE_URL` | none, required | Owner role URL; the only process that gets it on an install. Secret |
| `OPENDISPATCH_MIGRATIONS_DIR` | `migrations` (image: `/app/migrations`) | Migration files |
| `OPENDISPATCH_MIGRATE_TIMEOUT_SECONDS` | `1800` | Deadline of the whole run |

## bootstrap

`apps/api-go/cmd/bootstrap`, `/app/bootstrap` in the api image. First-run job: for each tenant in the tenants file
that was never bootstrapped, writes one group rule mapping the first Administrator's group to the Administrator
role, and its audit event.

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_APP_DATABASE_URL` | none, required | Application role URL (never the owner). Secret |
| `OPENDISPATCH_OIDC_TENANTS_FILE` | none, required | The api's tenants file |
| `OPENDISPATCH_BOOTSTRAP_ADMIN_GROUP` | none, required | Identity-provider group mapped to Administrator |
| `OPENDISPATCH_RECORD_DATA_SOURCE` | `SYNTHETIC` | As for the api |

## Engines

The Python engine services. See [engines](engines.md#server-limits) for the limits.

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_ENGINE` | none, required | `forecaster`, `optimizer`, `simulator` or `assignment` |
| `OPENDISPATCH_ENGINE_ADDR` | `0.0.0.0:8080` | Listen address |
| `OPENDISPATCH_CONTRACTS_DIR` | `../contracts/engines` (image: `/contracts/engines`) | JSON Schemas |
| `OPENDISPATCH_ENGINE_READ_TIMEOUT` | `10` | Socket timeout, seconds |
| `OPENDISPATCH_ENGINE_MAX_CONCURRENT` | `16` | Concurrent requests |
| `OPENDISPATCH_ENGINE_MAX_BODY` | `16777216` | Request bytes on the wire |
| `OPENDISPATCH_ENGINE_MAX_DECOMPRESSED` | `134217728` | Request bytes after gzip decoding |
| `OPENDISPATCH_ENGINE_MAX_LIST` | `2000000` | Items in one JSON list |
| `OPENDISPATCH_ENGINE_MAX_CONNECTIONS` | 8 times concurrent, at least 64 | Open connections |

## web

`apps/web`. Image `opendispatch/web`.

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_API_URL` | none, required | Base URL of the api, reached from the web server |
| `OPENDISPATCH_AUTH_MODE` | `demo` | `oidc` switches sign-in to the api's OIDC session |
| `DEMO_SESSION_SECRET` | none | Signs the demo session cookie; must match the api. Sign-in is unavailable when unset. Secret |
| `DEMO_COOKIE_SECURE` | off | `1` marks demo cookies `Secure` |
| `DEMO_EMERGENCY_ADMIN_PASSWORD`, `DEMO_EMERGENCY_ADMIN_TOTP` | unset | Emergency sign-in, as for the api. Secret |
| `OPENDISPATCH_CUSTOMER_SHORT_NAME`, `_AR` | as for the api | As for the api |
| `OPENDISPATCH_FIXTURES_DIR` | repository `fixtures/` | Fixtures directory |
| `PORT`, `HOSTNAME` | `3000`, `0.0.0.0` (image) | Next.js server listen settings |
| `NEXT_DIST_DIR` | `.next` | Build output directory (build time) |
| `NEXT_OUTPUT` | unset (image: `standalone`) | `standalone` builds the self-contained server (build time) |
| `OPENDISPATCH_MAP_BUILD`, `OPENDISPATCH_MAP_BBOX`, `OPENDISPATCH_MAP_MAXZOOM` | latest build, `34.4,16.3,55.7,32.2`, `11` | Basemap extract made by `scripts/fetch-map.sh` (build time) |

## Demo tools

Used by the Compose one-shot steps and the scripts in `scripts/db` and `scripts/demo`. They refuse to run against
anything but a local demo.

| Variable | Default | What it does |
|---|---|---|
| `OPENDISPATCH_DEMO` | unset | Must be `1` for `demoseed`, `demohistory` and `demoforecasts` to run |
| `OPENDISPATCH_DEMO_DB_HOSTS` | unset | Comma-separated database hosts the demo tools accept besides `127.0.0.1` and `localhost` (Compose sets `postgres`) |
| `OPENDISPATCH_MIGRATION_DATABASE_URL` | none | Owner role URL for the fixture seed (`pnpm seed:postgres`). Secret |
| `OPENDISPATCH_API_URL` | none | api the seed and the feeds simulator wait for |
| `OPENDISPATCH_TENANT_ID` | from `fixtures/manifest.json` | Tenant for `demoseed` and `demoforecasts` |

## Command-line tools

| Tool | Variables |
|---|---|
| `cmd/backtest` | `OPENDISPATCH_DATA_DIR` (a real extract, outside any git repository), `OPENDISPATCH_ENGINE_FORECASTER_URL`, `OPENDISPATCH_WEATHER_FILE` |
| `cmd/weatherfetch` | `OPENDISPATCH_APP_DATABASE_URL`, `OPENDISPATCH_TENANT_ID`, `OPENDISPATCH_WEATHER_CACHE_DIR` |
| `cmd/mockidp` (tests only) | `MOCKIDP_ADDR`, `MOCKIDP_CLIENT_ID`, `MOCKIDP_CLIENT_SECRET`, `MOCKIDP_ISSUER` |
| `scripts/backup/backup.sh` | `OPENDISPATCH_BACKUP_DATABASE_URL`, `OPENDISPATCH_BACKUP_S3_URL`, `OPENDISPATCH_BACKUP_S3_BUCKET`, `OPENDISPATCH_BACKUP_S3_ACCESS_KEY`, `OPENDISPATCH_BACKUP_S3_SECRET_KEY`, `OPENDISPATCH_PG_IMAGE`, `OPENDISPATCH_RCLONE_IMAGE` |
| `scripts/backup/restore.sh` | `OPENDISPATCH_RESTORE_ADMIN_URL`, `OPENDISPATCH_RESTORE_S3_URL`, `OPENDISPATCH_RESTORE_S3_BUCKET`, `OPENDISPATCH_RESTORE_S3_ACCESS_KEY`, `OPENDISPATCH_RESTORE_S3_SECRET_KEY`, `OPENDISPATCH_PG_IMAGE`, `OPENDISPATCH_RCLONE_IMAGE` |
| `scripts/bundle/bundle.sh` | `OPENDISPATCH_BUNDLE_VALUES` (chart values to read third-party images from), `OPENDISPATCH_BUNDLE_IMAGE_<NAME>` (take that image as it is) |
| `pnpm keycloak:dev` | `OPENDISPATCH_KC_STATE_DIR`, `OPENDISPATCH_KC_PROJECT`, `OPENDISPATCH_KC_PORT`, `OPENDISPATCH_KC_PUBLIC_URL`, `OPENDISPATCH_KC_REDIRECTS`, `OPENDISPATCH_KC_HOSTNAME`, `OPENDISPATCH_KC_HOSTNAME_ADMIN`, `OPENDISPATCH_KC_BOOTSTRAP_PASSWORD` |

## Tests

| Variable | What it does |
|---|---|
| `OPENDISPATCH_TEST_DATABASE_URL`, `OPENDISPATCH_TEST_APP_DATABASE_URL` | Turn on the Go tests that need PostgreSQL (owner and application role) |
| `OPENDISPATCH_TEST_SEEDED_TENANT` | Tenant of a seeded database for the live tests |
| `OPENDISPATCH_TEST_KEYCLOAK_ISSUER`, `..._CLIENT_SECRET`, `..._PASSWORD`, `..._CALLBACK_ADDR`, `..._ACME_ID`, `OPENDISPATCH_KEYCLOAK_IT_URL`, `OPENDISPATCH_KEYCLOAK_IT_ADMIN_PASSWORD` | Keycloak integration tests |
| `OPENDISPATCH_IMPORT_TEST_ROWS` | Row count of the large import test |
| `OPENDISPATCH_POOL_ADDR`, `OPENDISPATCH_SCALE_ADDR`, `OPENDISPATCH_SCALE_DUMP` | Opt-in engine load measurements |
