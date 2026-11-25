# OpenDispatch documentation

OpenDispatch forecasts demand for field work, plans crew rosters against that forecast, simulates the
service level a roster would reach, and ranks crew for each new case. It is built for operators in the
Gulf: the calendar it forecasts with knows the Umm al-Qura Hijri calendar, prayer times, Ramadan, Eid and
the Friday and Saturday weekend.

Everything in this repository runs on synthetic data. Every accuracy or service-level figure the product
shows on that data is illustrative, not a measured result.

## Start here

| Document | For |
|---|---|
| [Getting started](getting-started.md) | Run the full stack with Docker Compose, or each part from source |
| [Architecture](architecture.md) | Services, data flow, the forecast to roster to dispatch loop |
| [FAQ](faq.md) | Short answers to the usual questions |

## Reference

| Document | For |
|---|---|
| [Engines](engines.md) | Forecaster, roster optimizer, dispatch simulator, assignment scorer: inputs, outputs, running them alone |
| [Gulf calendar](gulf-calendar.md) | Hijri dates, prayer times, Ramadan and Eid, school periods, weekends, payday, and how they reach the forecast |
| [Data model](data-model.md) | Tables, tenancy with row-level security, `data_source` labels, the CSV case import format |
| [Configuration](configuration.md) | Every environment variable, by service |
| [API](api.md) | The OpenAPI contract, the permission model, rendering the reference |
| [Deployment](deployment.md) | Compose for evaluation, the Helm chart, offline bundle, backups, external Postgres, S3 and Keycloak |
| [Synthetic data](synthetic-data.md) | The deterministic generator, calibration targets, regenerating fixtures |

## Notes next to the code

| File | Covers |
|---|---|
| [`engines/README.md`](../engines/README.md) | The Python engines package |
| [`contracts/README.md`](../contracts/README.md) | Contract layout and conventions |
| [`scripts/synthetic/README.md`](../scripts/synthetic/README.md) | Generator internals |
| [`apps/api-go/migrations/README.md`](../apps/api-go/migrations/README.md) | Migration rules |
| [`apps/api-go/internal/backtest/README.md`](../apps/api-go/internal/backtest/README.md) | The backtest command |
| [`apps/web/src/lib/access/README.md`](../apps/web/src/lib/access/README.md) | Roles, modules and the access matrix |
| [`apps/web/messages/README.md`](../apps/web/messages/README.md) | English and Arabic message files |

## Contact

Questions that do not fit an issue: omni2@theomni-labs.com.
