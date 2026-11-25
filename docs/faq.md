# FAQ

## General

**What does OpenDispatch do?**
It forecasts how many field cases each area will get in each 15 minutes of the coming days, builds crew rosters that
cover that demand, simulates the service level a roster would reach, and ranks crew for each new case on a live
board. See [architecture](architecture.md).

**Does it dispatch crews automatically?**
No. Live assignment runs in shadow mode (it records what it would have picked and compares it with the real decision)
or recommend mode (a dispatcher sees the top candidate and accepts or overrides it). The contract has an `automatic`
stage, but there is no outbound connector that sends an assignment to crews or to another dispatch system, and the
source system's own assignment always wins. See
[live assignment](architecture.md#live-assignment-shadow-and-recommend-not-automatic-dispatch).

**How accurate is the forecast?**
Not known. The repository contains synthetic data only, and every accuracy or service-level figure the product shows
on it is illustrative. The backtest tooling measures accuracy on your own history; run it on a real extract before
relying on any number. See [engines](engines.md#champion-challenger-and-backtests).

**Is the data in the demo real?**
No. Every person, place name, case and coordinate is invented by the generator in `scripts/synthetic` and labelled
`SYNTHETIC`. City anchors are approximate public city-centre points used only to place the map. See
[synthetic data](synthetic-data.md).

**Who is it for?**
Operators that send field crews to incidents and plan their shifts, especially in the Gulf, where the Hijri calendar,
prayer times and the Friday and Saturday weekend shape demand.

## Calendar and regions

**Why a Gulf calendar?**
Ramadan, Eid and Hajj move through the Gregorian year, prayer times change daily, and the weekend is Friday and
Saturday. A model that only knows Gregorian weekdays misreads all of that. See [Gulf calendar](gulf-calendar.md).

**Can I use it outside the Gulf?**
Partly. The calendar features are optional per day and their effects are learned from history, so they do no harm
where they do not apply. But several things assume the sample region today: local time is `Asia/Riyadh` throughout,
the Hijri and Gregorian events are fixed in `internal/forecastcal`, the import mapping's service area is a box around
the Arabian Peninsula, and the map extract covers the same area. Changing those is a code change.

**Where do prayer times come from?**
They are computed with adhan-go, Umm al-Qura method, at each city's location, and stored in `prayer_times`.

## Data

**How do I load my own cases?**
Export them as CSV in the `generic_csv_v1` layout and import them in Admin, Data Import and Quality. The columns,
validation and cleaning rules are in [data model](data-model.md#case-import-format-generic_csv_v1), with an example
file in `docs/examples/cases_example.csv`. Locations, case types and agents must exist first, with external ids your
export uses.

**My export has different column names.**
Save a new mapping version (Admin, or a new file next to `config/mappings/generic_csv_v1.json`). With the assistant on,
it can suggest a mapping from your header; a person saves it.

**How are tenants kept apart?**
PostgreSQL row-level security on every customer table, forced, with an application role that cannot bypass it, and
the tenant set on each transaction from the signed-in session. See [data model](data-model.md#tenancy).

**Can I live-feed cases?**
Yes, through the signed webhooks in `contracts/feeds.openapi.yaml`, with `OPENDISPATCH_FEED_KEYS_FILE` and
`OPENDISPATCH_DISPATCH_SOURCE=feeds`. The Compose demo does this with a simulator.

## Running it

**What does it need?**
For evaluation, Docker with Compose. For an install, Kubernetes, PostgreSQL 16 (TimescaleDB `-oss` recommended), an
S3-compatible store and an OIDC provider (Keycloak is supported and can run in the chart). See
[deployment](deployment.md).

**Can it run without internet?**
Yes. The images can be carried in an offline bundle, the engines run offline, and the assistant can use a local model
through Ollama. Build the web image with `OPENDISPATCH_FETCH_MAP=0` if the build host has no internet (the map then has
no basemap tiles). Weather from Open-Meteo needs internet; leave `OPENDISPATCH_WEATHER_SOURCE` at `none` or use a file.

**Does the AI assistant make decisions?**
No. It is off by default. When on, it explains screens, answers questions about the data, summarises handovers and
drafts rules, scenarios, calendar events and import mappings for a person to review. It never produces a forecast,
roster, simulated figure or assignment. With `ollama` nothing leaves the install; with `openai` the prompts go to the
endpoint you configure.

**How do I reset the demo?**
`docker compose down -v`, then `docker compose up --build`.

**The web app shows "Assistant not configured".**
`OPENDISPATCH_ASSISTANT_PROVIDER` is `off` (the default). See [configuration](configuration.md#ai-assistant).

**Imports fail with "the file storage is not available".**
The api has no object-store credentials. Set `OPENDISPATCH_S3_ACCESS_KEY` and `OPENDISPATCH_S3_SECRET_KEY` and check the
endpoint, port and bucket.

## Contributing

**How is the code organised?**
`apps/web` (Next.js), `apps/api-go` (Go api, worker and tools), `engines/` (Python), `contracts/` (OpenAPI and JSON
Schemas), `scripts/` (generator, tooling), `deploy/` (Compose helpers, Helm, Keycloak). See
[architecture](architecture.md#repository-layout).

**I want to add an api operation.**
Add it to `contracts/openapi.yaml` with its `x-module` and `x-required-access`, run `pnpm validate:contracts` and
`pnpm generate:types`, implement it in `apps/api-go/internal`, then use it from the web app's data layer. See
[API](api.md#change-the-contract).

**I want to try a new forecast model.**
Add a module under `engines/src/opendispatch_engines/forecaster/`, register it in `registry.py`, and compare it with the
champion using `cmd/backtest -models`. On synthetic data the comparison checks mechanics; real accuracy needs real
history.

**Can I help with the Arabic?**
Yes. None of the Arabic has been reviewed by a native reader yet. See
[`apps/web/messages/README.md`](../apps/web/messages/README.md).

**What licence?**
AGPL-3.0-only.
