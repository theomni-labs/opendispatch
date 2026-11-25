# backtest

The evidence harness for the forecaster and the assignment scorer: rolling-origin forecast backtests, model
comparisons and an assignment replay. The api runs the forecast part in the background for Forecast and Model Admin;
`cmd/backtest` runs all of it from the command line. Tested on synthetic data only; it runs unchanged on a real
extract read at runtime from outside the repository.

```sh
go run ./cmd/backtest -synthetic [-out DIR]                     # the committed fixtures
go run ./cmd/backtest -long-synthetic -weeks 104 [-seed N]      # a long synthetic history with known effects
OPENDISPATCH_DATA_DIR=/secure/extract go run ./cmd/backtest -out /secure/results
```

`-long-synthetic` (`-weeks`, `-seed`, `-end`, `-volume`) generates years of history in memory with known, made-up
effects (`longsynth.go`); it measures the mechanics of the models, not accuracy.

## Forecast backtest

Rolling origin by day (`-origin-step-days`). For each origin with at least `-min-history` days before it and a full
`-horizon` after it, the candidate gets history strictly before the origin and is scored against actual case counts
at zone and hour. `-held-out-days` scores only the last days of the data.

**Candidates** (`-forecaster`): `seasonal-mean` (a 4-week mean, the default), `none`, or `engine`, which calls the
forecaster over HTTP (`-engine-url` or `OPENDISPATCH_ENGINE_FORECASTER_URL`) with `-model-version`. History sent per
request: `-history-days` at 15 minutes, or `-history-detail-weeks` at 15 minutes plus older years as totals
(`-history-years`, `-history-aggregate-minutes` 60 or 1440). `-active-subzone-days` sends only sub-zones with a case
in that many days before the origin.

**Metrics.** MAE, WAPE, MAPE, RMSE and coverage of the likely range, at zone and hour and at 15 and 30 minutes, by
zone, hour, weekday and day type, plus bias and a staffing translation (agent-hours over and under need). The
zone-hour range is the sum of sub-zone ranges, so it is wider than a true zone range. The candidate is scored by its
expected values and by the Poisson median of each cell.

**Baselines.** `naive` (same interval last week, with a Poisson range) and `segment` (the average of the zone's
history on the same kind of day: day group by school status or event).

**Gate** (`-gate-baseline naive|segment`, `-gate-point median|expected`): the engine passes when its WAPE beats the
baseline's by at least `-gate-min-improvement` (default 0.10) and it is worse in at most `-gate-max-worse-zones` of
zones (default 0.25). Fewer than 56 training days before the first origin gives `not_enough_history`.

**Blend.** With `-shape-share` and `-small-zone` the candidate is blended with the segment average as the product
does: per zone-day the engine's total (averaged with the segment total below `-small-zone` cases a day), spread partly
by its own shape and partly by the segment shape. With `-day-types` (default on), Ramadan by school status, Eid days,
Arafah Day and national days take their own shape from up to three years of history.

**Calendar.** `-payday-day` and `-calendar-file` (JSON with `school_terms`, `season_events`, `umrah_windows`) set the
calendar sent to the engine; Hijri events are derived as in the product (`internal/forecastcal`).

**Weather.** `-weather none|synthetic|file` (`file` reads `OPENDISPATCH_WEATHER_FILE`). Only days before each origin
get observed weather, never a held-out day's. `-weather-in-data` lets synthetic weather change the history while
sending none, for a with-and-without comparison. `-weather-perfect-forecast` (research only) also sends the held-out
days' own weather; the report then carries `perfect_forecast_weather: true` and says so in its notice.

## Model comparison

`-models ensemble-4,ensemble-5,lightgbm-1` compares engine model versions with both baselines in one run: the same
origins (`-compare-windows name=YYYY-MM-DD:days,...`, default an ordinary month and a Ramadan and Eid month) on the
same `-long-synthetic` history for each seed. It writes `comparison.json` (`-compare-out`) with per-model metrics
overall and by zone, hour, weekday, day type, window and seed, bias, staffing translation, seconds per request and a
ranking. A model the engine answered with another `model_version` is marked unavailable and not ranked.

## Assignment replay

Field cases with `assigned_at`, `arrived_at`, a position and an agent are replayed at the recorded `assigned_at`.
Candidates are agents with a case within `-duty-window-hours` who are not busy, positioned at their previous case or
their standby point; the agent actually chosen is always included. Travel is straight line at `-speed` km/h. Arms: the
recorded outcome, the recorded choice, and each assigner under the same travel model, each shown from assignment and
from registration (`-primary-clock`), with the share within 10 minutes, agreement with the recorded choice, and
decision time against `-deadline-ms` and `-fallback-ms`. Baseline: nearest agent. Rosters, vehicles and skills are not
used for availability.

`-only all|forecast|replay` runs one part. `-json` prints the JSON report.

## Input format

Under `OPENDISPATCH_DATA_DIR` (the same layout as `fixtures/`), all optional except cases:

- `cases/*.json`, `cases.json`: arrays of case objects; or `cases/*.csv`, `cases.csv` with a header row of the same
  field names. Used fields: `id`, `data_source` (required on every case), `registered_at`, `assigned_at`, `arrived_at`,
  `closed_at` (RFC 3339), `zone_id`, `sub_zone_id`, `latitude`, `longitude`, `handling`, `agent_id`. With
  `-synthetic`, `fixtures/cases/*.json` and `fixtures/replay/cases.json` are read.
- `people/agents.json`: `id`, `kind`, `is_active`, `extra.standby_point_id`.
- `locations/standby_points.json`: `id`, `latitude`, `longitude`.
- `locations/sub_zones.json`: `id`, `zone_id`.

## Output and guards

`report.json` and `report.txt` in `-out` (default: a new temporary directory). Nothing is written elsewhere.

- Real mode needs `OPENDISPATCH_DATA_DIR` and refuses a data directory inside a git repository.
- When `OPENDISPATCH_DATA_DIR` is set, or `-synthetic` is absent, an `-out` inside a git repository is refused.
- Reports hold aggregates only, never case rows. Every report states its `data_source`; for SYNTHETIC or mixed data
  it sets `illustrative: true` and says: "Synthetic data: these figures say nothing about accuracy on real cases."
