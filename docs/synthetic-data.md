# Synthetic data

OpenDispatch ships with an invented world so you can run, test and evaluate it without anyone's real data. Every
value is made up, every record is labelled `data_source: SYNTHETIC`, and every figure computed from it is
illustrative: it shows that the mechanics work, not how accurate the product is on real cases.

There are two generators:

| Generator | Writes | Used by |
|---|---|---|
| `scripts/synthetic` (TypeScript) | `fixtures/`: one week of cases and everything around them | Tests, the web app in fixture mode, the database seed |
| `internal/synthetic` and `internal/backtest/longsynth.go` (Go) | Years of case history in memory or into a demo database | The Compose `history` step, backtests (`-long-synthetic`) |

Both read the same input, `scripts/synthetic/calibration.json`.

## The world

- One tenant, "Example Response (synthetic)", id `8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55`.
- Three cities (Riyadh, Jeddah, Dammam), eight dispatch zones, 111 invented sub-zones, three to five standby points per
  zone. City anchors are approximate public city-centre points used only to place the map; every other coordinate is
  an invented offset from them, and every place name is invented.
- 42 agents and 14 vehicles per zone, a quarter of the agents remote. Names are built from lists and syllables.
- Three case types: Standard case, Police attended, Unlisted.
- A case week from Sunday 6 to Saturday 12 September 2026, 1,500 cases a day, and a demo "today" of Sunday
  13 September 2026 whose new field cases are the replay day.
- Reference data: shift patterns, break rules, classification rules, holidays and Hijri months of 2026, prayer
  times, users for every role, settings, notifications, import jobs and audit events.

## Determinism

The same `calibration.json` and code always write the same bytes.

- One seed (`structure.seed` in `calibration.json`), an in-repository `mulberry32` generator and a string hash
  (`scripts/synthetic/gen/rng.ts`). No `Math.random`, no `Date.now`, no argument-less `new Date()`; a test scans the
  sources for them.
- Stable iteration order; ids are UUIDs derived from the seed, a kind and a key.
- Hijri dates come from `Intl` (`islamic-umalqura`) and prayer times from adhan (Umm al-Qura method), both identical in
  every machine time zone.
- `generate.test.ts` runs the generator twice in fresh processes with two different time zones, requires identical
  output, and requires the committed `fixtures/` to equal a fresh run.

## Calibration targets

`calibration.json` has one section per concern (`structure`, `locations`, `demand`, `targets`, `timing_model`,
`handling_model`, `remote_queue`, `movement`, `roster_model`, `people`, `roles_and_settings`, `calendar`, `fixtures`,
`workforce`). Every leaf is `{ "value": ..., "source": "assumption" }`: our own invented choice.

`targets` lists what the generated week must reproduce, each with a tolerance:

| Target | Tolerance |
|---|---|
| Remote share of cases | plus or minus 3 points |
| Registered to assigned, median and 90th percentile (field cases) | plus or minus 10% |
| Assigned to arrived, median and 90th percentile | plus or minus 10% |
| Arrived to closed, median | plus or minus 10% |
| Late-night ratio (00:00 hour over 06:00 hour) and morning ramp (07:00 slot over 06:00 slot) | plus or minus 10% |
| Parties: two, three or more, and a ceiling on zero or one | plus or minus 3 points; ceiling |
| Field share per case type | plus or minus 3 points |
| Case share per city, zones per city | plus or minus 3 points; exact |
| Share arrived within 10 minutes of assignment and of registration, case-type mix | plus or minus 3 points |

`pnpm calibration:check` recomputes each target from `fixtures/`, prints target, wanted, actual, tolerance and PASS or
FAIL, and exits non-zero on any failure. The day shape and busiest days are checked by eye from the charts it writes:
[`docs/calibration/daily-shape.svg`](calibration/daily-shape.svg) and
[`docs/calibration/cases-per-weekday.svg`](calibration/cases-per-weekday.svg). `--ramadan` also draws the
generator's Ramadan profile for a sample day; `--no-charts` prints the table only.

The targets are inventions chosen to look like a plausible operation. They are not measurements of any real one.

## Commands

```sh
pnpm generate:fixtures                      # write fixtures/ and fixtures/manifest.json
pnpm generate:fixtures -- --out /tmp/fx     # write somewhere else
pnpm validate:fixtures                      # every record against its contract schema, plus integrity checks
pnpm calibration:check                      # the targets above, and the charts
pnpm synthetic:sim-groundtruth              # simulator replay days with known outcomes, for the engine tests
pnpm test:pure                              # includes scripts/synthetic/**/*.test.ts
```

## Regenerating fixtures

After changing `calibration.json` or any generator code:

1. `pnpm generate:fixtures`
2. `pnpm validate:fixtures` and `pnpm calibration:check`
3. `pnpm synthetic:sim-groundtruth` if the change affects case timings or movement
4. Commit `fixtures/` (and `engines/tests/data/sim_groundtruth/`) together with the change. Tests fail while the
   committed files differ from what the generator writes.

Never edit files under `fixtures/` by hand. `fixtures/manifest.json` lists every file with its schema, kind and record
count, and is what the data layer and the seed read.

## Long synthetic history

The Compose `history` step (`cmd/demohistory`) and `cmd/backtest -long-synthetic` generate years of cases in the
same world, with known, made-up effects: a yearly trend, payday and salary window, school breaks, Ramadan day,
iftar and night shapes, Eid, Hajj, National Day and Founding Day (`DefaultEffects` in
`apps/api-go/internal/backtest/longsynth.go`). Because the effects are known, a backtest can check that a model
recovers them. That tests the mechanics of the models; it says nothing about accuracy on real cases, and every report
says so.

`demohistory` refuses to write unless `OPENDISPATCH_DEMO=1` and the database host is local (or listed in
`OPENDISPATCH_DEMO_DB_HOSTS`).

## Sample import files

`pnpm generate:fixtures` also writes `apps/web/public/samples/locations_sample.csv` and `agents_sample.csv`, the
sample files of the Admin import dialogs. For the case import format see
[`docs/examples/cases_example.csv`](examples/cases_example.csv) and [data model](data-model.md#case-import-format-generic_csv_v1).

More detail on the generator's internals is in [`scripts/synthetic/README.md`](../scripts/synthetic/README.md).
