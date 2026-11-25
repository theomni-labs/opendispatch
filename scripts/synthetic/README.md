# Synthetic data generator

Writes `fixtures/` from one input, `calibration.json`. Everything here is invented: the file holds summary numbers and
structural parameters, never rows of real data and never real coordinates. Every record is `data_source: SYNTHETIC`
and every figure derived from the fixtures is illustrative. The user-facing overview is
[`docs/synthetic-data.md`](../../docs/synthetic-data.md).

## Commands

```sh
pnpm generate:fixtures                    # write fixtures/ and fixtures/manifest.json
pnpm generate:fixtures -- --out <dir>     # write somewhere else (the tests do this)
pnpm validate:fixtures                    # every record against its contract schema, plus integrity checks
pnpm calibration:check                    # every numeric target against the fixtures; charts in docs/calibration/
pnpm calibration:check --ramadan          # also the Ramadan-profile chart (drawn from the generator's profile)
pnpm calibration:check --no-charts        # table only
pnpm synthetic:sim-groundtruth            # 14 simulator replay days with recorded outcomes, to engines/tests/data/sim_groundtruth
pnpm test:pure                            # includes scripts/synthetic/**/*.test.ts
```

After changing `calibration.json` or generator code, run `pnpm generate:fixtures` (and `synthetic:sim-groundtruth`
when timings or movement change) and commit the result with the change. `generate.test.ts` runs the generator twice
in fresh processes with two machine time zones, requires byte-identical output, and requires the committed `fixtures/`
to equal a fresh run. `sim-groundtruth.test.ts` does the same for the simulator data.

## What is written

`fixtures/manifest.json` is the interface the data layer and the seed read: `{ "files": [ { path, schema, kind, count } ] }`.
`schema` is a component schema of `contracts/openapi.yaml` (for example `Case`) or an engine schema name (for example
`forecaster.output`). `kind` is `array` or `object`. Case files are split per day.

| Area | Files | Schema |
|---|---|---|
| Locations | `locations/cities`, `zones`, `sub_zones`, `standby_points` | City, Zone, SubZone, StandbyPoint |
| Reference | `reference/case_types`, `shift_patterns`, `break_rules`, `classification_rules`, `rule_versions`, `approvals`, `holidays`, `hijri_months`, `prayer_times`, `model_versions` | matching component names |
| Admin | `admin/users`, `role_mappings`, `settings`, `notification_rules`, `integrations`, `notifications`, `import_jobs`, `data_quality_issues`, `audit_events` | User, RoleMapping, Setting, ... |
| People | `people/agents`, `vehicles`, `agent_skills`, `leave_requests` | Agent, Vehicle, AgentSkill, LeaveRequest |
| Cases | `cases/2026-09-06.json` to `cases/2026-09-12.json` | Case |
| Plans | `plans/forecast_runs`, `forecast_values/<zone code>`, `rosters`, `roster_assignments/<date>`, `overrides`, `scenarios`, `simulation_runs`, `simulation_results` | matching component names |
| Live | `live/assignments`, `assignment_events`, `assignment_comparisons` | Assignment, AssignmentEvent, AssignmentComparison |
| Roll-ups | `rollups/dashboard_rollups`, `productivity_rollups` | DashboardRollup, ProductivityRollup |
| Engines | `engines/forecaster.output`, `optimizer.output`, `simulator.output` | the engine output schemas |
| Replay | `replay/cases`, `replay/assignment_outputs`, `replay/script` | `ReplayCase`, `assignment.output`, `ReplayScript` |

Two names are fixture-only, so the replay day never mixes into the case history:

- `ReplayCase` is a `Case` (the manifest entry carries `"contract_schema": "Case"`): the new field cases of the demo
  day, Sunday 13 September 2026. Their `agent_id`, `vehicle_id`, `assigned_at`, `arrived_at` and `closed_at` are the
  synthetic "actual" pick and times for the shadow-mode comparison; reveal them only as the replay clock passes them.
- `ReplayScript` holds scripted events: one dispatcher reassignment with its reason and one feed outage window.

The engine fixtures come from placeholder logic in the generator (for example `gen/recommend.ts`, nearest agent by
estimated travel time), not from the engines. They let the app run in fixture mode.

## Sample import files

`pnpm generate:fixtures` also writes `apps/web/public/samples/locations_sample.csv` and `agents_sample.csv`, the files
behind "Use a sample file" in the Admin import dialogs (`gen/build-samples.ts`). They are not in the manifest. They
import into a fresh demo database without conflict; `samples.test.ts` checks that.

## Agent status and position (computed, not stored)

`positions.ts` exports pure, deterministic functions the app can call while the replay plays:

```ts
import { agentStateAt, allAgentStatesAt } from '<repo>/scripts/synthetic/positions';
agentStateAt(seed, agentId, '2026-09-13T09:41:30+03:00');
// { agent_id, status: 'available'|'assigned'|'en_route'|'on_scene'|'on_break'|'offline', phase, latitude, longitude,
//   position_at, zone_id, vehicle_id, current_case_id, speed_kmh, heading_deg }
```

`seed` is `structure.seed.value` of `calibration.json`. The function rebuilds the day plans the fixtures were written
from, so an agent is `en_route` exactly between the departure and arrival their case implies, `on_scene` until
`closed_at`, then drives back to a waiting spot near their standby point. It imports no Node module, so it bundles.
The first call plans 8 days and takes a moment; later calls are fast.

## How it works

1. **World** (`gen/locations.ts`, `gen/people.ts`): 3 cities, 8 zones, 10 to 18 sub-zones each, 3 to 5 standby points
   per zone, agents and vehicles per zone, a share of the agents remote.
2. **Day plan** (`gen/dayplan.ts`): cases per 15-minute slot from the demand shape (`gen/demand.ts`), exact quotas for
   city, case type and parties, coordinates around sub-zone centres, field quotas per case type, and lognormal timings
   whose median and 90th percentile come from `targets`. Draws are stratified, so sample quantiles sit on the targets.
   A field case goes to an agent who is on shift, idle and not on break, chosen so the implied road speed is
   plausible; remote cases go through a first-come review queue per city.
3. **Drive model** (`movement.drive_model`): assigned to arrived is acknowledgement plus setup plus drive, where drive
   is road distance over a speed that varies by hour and zone, with lognormal noise. After a case, the agent drives
   back and can be dispatched on the way. Travel time therefore follows distance, hour and zone, which is what the
   simulator models.
4. **Records** (`gen/build-*.ts`): contract records in the field order of the schemas.
5. **Checks**: `validate-fixtures.ts` (contracts and integrity) and `check.ts` (calibration).

Determinism: one seed, `mulberry32` plus a string hash (`gen/rng.ts`), no `Math.random`, no `Date.now`, no
argument-less `new Date()` (a test scans the sources), stable iteration order, UUIDs derived from seed, kind and key.

## The calibration check

`check.ts` recomputes every numeric target in `calibration.json` from the fixtures and prints target, wanted, actual,
tolerance and PASS or FAIL (plus or minus 10% relative on medians, percentiles and ratios; plus or minus 3 points on
shares; the parties-zero-or-one row is a ceiling). It exits non-zero on any FAIL. The day shape and busiest days are
checked by eye from `docs/calibration/daily-shape.svg` and `cases-per-weekday.svg`. The case week has no Ramadan day, so
`--ramadan` draws the generator's Ramadan profile for a sample day in Ramadan 1447 (4 March 2026, Riyadh prayer times
from adhan).

Registered-to-assigned is computed over all field cases, including the few assigned before registration (negative
values), as a plain calculation on the source columns would.

## Assumptions

Every value in `calibration.json` carries `"source": "assumption"`. The groups:

- **Scale and structure** (`structure`, `locations`): seed, tenant id and name, the case week and demo day, cases per
  day, agents and vehicles per zone, remote share, sub-zone spacing, coverage radius. City anchors are approximate
  public city-centre points; zone offsets, radii, sub-zone centres, standby points, case coordinates and names are
  invented. Arabic name fields are `null`.
- **Demand** (`demand`): hourly levels of the day, pinned slots for the night and morning ramp, slot noise, weekday
  multipliers, the Ramadan profile (chart only), and a small share of cases assigned before registration.
- **Case attributes** (`handling_model`, `timing_model`, `remote_queue`): parties, field share per case type, case-type
  mix, injury, damage, severity and channel, lognormal timing models, remote review times and reviewer capacity.
- **Movement** (`movement`): road factor, speed bounds, waiting-spot radius, the drive model's hour and zone factors.
- **People, shifts, leave** (`people`, `roster_model`, `workforce`): names, skills vocabulary, shift split, days off,
  break placement, leave requests, sickness and attendance for the workforce screens.
- **Reference data and settings** (`roles_and_settings`, `calendar`): shift patterns and classification rules (shift
  times marked `extra.assumption: true`), predicate field names, one demo user per role plus a few extra users on the
  reserved `.example` domain, setting values (clock start `assignment`, planning level `zone`, live stage `shadow`
  except two Riyadh zones on `recommend`), holidays of 2026 from general knowledge with Hijri dates from `Intl`, and
  prayer times from adhan at the city anchors.
- **Plans and live** (`fixtures`): a one-day forecast shaped from the calibration (not learned), rosters for the demo
  week, overrides, scenarios, simulation runs, and one day of assignments and shadow comparisons from the placeholder
  recommender.

## Not generated

`agent_status` and `agent_positions` (computed by `positions.ts`), and the Admin tables the seed does not need:
`api_clients`, `webhooks`, `webhook_deliveries`, `control_evidence`, `job_runs`, `support_access_events`, identity
providers.

## Files

```
calibration.json        the only input
generate.ts             entry point
validate-fixtures.ts    contract and integrity validation
check.ts                calibration check and charts
positions.ts            agentStateAt, allAgentStatesAt, plannedCasesForDay
sim-groundtruth.ts      simulator replay days for the engine tests
gen/                    rng, dist, time, locations, people, demand, dayplan, calendar, recommend, build-*, io, charts
*.test.ts               vitest, next to the code
```
