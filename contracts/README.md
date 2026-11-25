# Contracts

The single source of truth for OpenDispatch types. The web app's TypeScript types are generated from here, the Go
api is tested against it, the fixtures are validated with it, and the engines are reached only through it. A
reader's guide is in [`docs/api.md`](../docs/api.md).

## Layout

```
contracts/openapi.yaml                          api contract, OpenAPI 3.1: operations and component schemas
contracts/feeds.openapi.yaml                    inbound feeds: signed webhooks for cases and agent status
contracts/engines/<engine>.input.schema.json    JSON Schema 2020-12, one input and one output per engine:
contracts/engines/<engine>.output.schema.json   forecaster, optimizer, simulator, assignment, reposition
contracts/engines/examples/                     an example request per engine
contracts/platform/update-agent.yaml            stub of the update agent's local API (Updates screen, private installs)
contracts/redocly.yaml                          lint configuration
scripts/contracts/schemas.ts                    importable schema access (below)
scripts/contracts/invariants.ts                 engine invariants JSON Schema cannot express
scripts/contracts/generate-types.ts             pnpm generate:types
scripts/contracts/validate-contracts.ts         pnpm validate:contracts
apps/web/src/lib/types/                         generated, never edited by hand
```

`openapi.yaml` refers to engine outputs with `$ref: './engines/<name>.schema.json'` and does not repeat them.

## Commands

```sh
pnpm generate:types           # write apps/web/src/lib/types/ (api.ts, update-agent.ts, engines/*.ts, index.ts)
pnpm generate:types --check   # exit 1 if the generated files are out of date
pnpm validate:contracts       # lint, strict Ajv compile, $ref resolution, examples, self-tests, operation rules
pnpm exec redocly build-docs contracts/openapi.yaml -o openapi.html   # browsable reference
```

Generated output is deterministic (sorted, no timestamps) and starts with a "GENERATED, do not edit" header. Import
types from the barrel `apps/web/src/lib/types`: every component schema under its own name (`Case`, `Roster`,
`AssignmentComparison`), plus `components`, `operations`, `paths`, the update-agent types, and the engine types
(`ForecasterOutput`, `AssignmentInput` and so on). Use the barrel rather than `api.ts`, which is large because
Redocly hoists the engine schemas' `$defs` into it.

## Validating data against the contracts

`scripts/contracts/schemas.ts` has a stable API, documented at the top of the file:

```ts
import { createAjv, getComponentSchema, getEngineSchema, listComponentSchemas } from '../contracts/schemas.js';
const validate = createAjv().compile(getComponentSchema('Case'));
validate(row) || console.error(validate.errors);
```

`getComponentSchema(name)` returns a fully dereferenced JSON Schema 2020-12; `createAjv()` returns the strict Ajv
(with formats) the contracts are checked with. `checkEngineInvariants(name, doc)` in `invariants.ts` checks what the
schemas only describe: low <= expected <= high, 96 intervals per day, gap kind against the sign of delta, the
arithmetic of both 10-minute readings, ranking order.

## Conventions

- **Records.** Every persisted record is `allOf: [BaseRecord, {...}]` with `unevaluatedProperties: false`.
  `BaseRecord` has `id`, `tenant_id`, `created_at`, `updated_at`, `created_by` (null for the system) and
  `data_source` (`SYNTHETIC`, `IMPORTED`, `LIVE`). Primary key `(tenant_id, id)`. Source-specific data goes in
  `extra`. One `data_source` per record; mixed inputs are listed in `input_data_sources`.
- **Requests.** Separate `*Write`, `*Create` or `*Update` schemas with `additionalProperties: false`. `PUT` replaces,
  `PATCH` changes some fields.
- **No context from the caller.** No operation takes a tenant, customer, role or context parameter;
  `validate:contracts` refuses the names `tenant`, `tenant_id`, `customer`, `customer_id`, `role` and `context` in
  parameters and request bodies. A managed user's role is `assigned_role`.
- **Every operation** has `operationId`, `tags: [<x-module>]`, `x-module`, `x-required-access` (`view` or `edit`) and
  a `4XX` response. Lists are cursor paginated (`limit` 1 to 200, default 50; `cursor`; response `items` and `page`).
  Bounded views (a 96-interval timeline, a day of gap cells) are not paginated.
- **Extensions.** `x-approval: true` (approve or reject: needs a role in the module's `approvers`, never one's own
  request), `x-install-modes` (for example `[private]`), `x-keycloak-side: true` (state lives in Keycloak or the update
  agent; the api passes it through), `x-demo-only: true` (demo mode only).
- **`x-modules`** at the root is the access matrix as data: each module, each role's `none`, `view` or `edit`, and the
  approver roles. `validate:contracts` checks it against its own copy of the matrix.
- **Time.** ISO 8601 with an offset, `+03:00` by convention (not enforced by the schema); dates `YYYY-MM-DD`; times
  `HH:MM`, where an end time of `00:00` means midnight.
- **Errors.** `ApiError` (named so the generated barrel does not shadow the global `Error`): a stable `code`, a
  plain-language `message`, optional `request_id` and field `details`.
- **Both 10-minute readings** (from registration and from assignment) are always present in results; a setting
  chooses which is primary.
- **Engine outputs** carry `data_source`, `input_data_sources`, `illustrative`, `engine.version`, `model_version` and
  `generated_at`. Every engine schema has a stable `$id` on the reserved `opendispatch.example` domain, a `title`, root
  `additionalProperties: false` and `examples`. `$defs` names in output schemas are unique across engines.
- **Engine payloads carry no tenant.** The worker holds the tenant and stores results under it.

## Modelling choices worth knowing

- **Closed records.** Responses reject unknown properties so fixture typos fail. A server adding a response field is
  therefore a contract change; clients built on the generated types ignore unknown fields at runtime.
- **Shared areas.** Besides the 30 modules, `platform.session` (context, settings snapshot, own notifications,
  approvals inbox, health), `platform.records` (read-only master data and cases, filtered by zone scope) and
  `platform.demo` (demo operations) hold shared endpoints. Writes to master data live in the Admin module that owns it.
- **Classification rules.** `rule_code` matches `^RULE-[0-9]{3}[A-Z]?$` and is the path identifier; the record `id` is
  still a UUID. A rule has versions (`draft`, `submitted`, `active`, `rejected`, `retired`, `superseded`) with an
  effective date. Conditions are structured predicates (`field`, `operator`, `value`). Outcomes are
  `remote_eligible`, `field_mandatory`, `field_preferred`; field mandatory wins over field preferred over remote
  eligible, and no match gives field preferred.
- **Shift patterns** have `normal` and `ramadan` hours with an `applies` flag, a derived `crosses_midnight`, and a
  `status` of draft or active.
- **Forecast output** carries expected field and remote counts per interval beside low, expected and high
  (`range_coverage` 0.8 by default). The optimizer reports one primary `cause` per gap cell. Assignment reason codes
  are a fixed list (`AssignmentReasonCode`) with an English sentence as fallback; screens translate from the codes.
- **Imports of locations and agents** send the CSV text in a JSON body and are all or nothing; a bad file is a
  validation error naming the first bad rows. Case imports use the upload, validate and cut-over flow in
  `docs/data-model.md`.
- **Stored, not applied.** Quiet hours and API rate limits are stored settings that nothing enforces yet; the screens
  say so. Webhook test and retry are scripted and send nothing.
- **Update agent.** `contracts/platform/update-agent.yaml` is a stub of an update agent's local API, not a finished
  contract. Its records carry no `data_source`, unlike every other record. `cancelScheduledUpdate` and
  `getUpdateRecovery` exist in `openapi.yaml` only.
