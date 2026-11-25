# API

The api's contract is `contracts/openapi.yaml` (OpenAPI 3.1). It is the single source of truth for the shapes of
requests, responses and records: the TypeScript types in `apps/web/src/lib/types/` are generated from it, the Go
handlers are tested against it, and the fixtures are validated with it.

## Contract files

| File | What it describes |
|---|---|
| `contracts/openapi.yaml` | Every operation the web app uses, under `/api/v1`, and every record schema |
| `contracts/feeds.openapi.yaml` | Inbound feeds: signed webhooks for cases (`/feeds/v1/cases`) and agent status (`/feeds/v1/agent-status`) |
| `contracts/engines/*.schema.json` | Engine requests and answers (JSON Schema 2020-12); see [engines](engines.md) |
| `contracts/platform/update-agent.yaml` | A stub of the local API of an update agent that the Updates screen talks to in private installs |
| `contracts/redocly.yaml` | Lint configuration |

## How `openapi.yaml` is organised

- **`info.description`** states the conventions below.
- **`tags`**: one per module. Ops modules (`ops.forecast-explorer` and eleven more), Admin modules
  (`admin.users-roles` and seventeen more), and three shared areas: `platform.session` (session, settings snapshot,
  own notifications, approvals inbox), `platform.records` (read-only master data and cases) and `platform.demo`
  (demo-only operations).
- **`x-modules`**: the access matrix as data. Each module lists its console, number, title, the access of every role
  (`none`, `view` or `edit`) and the roles that may approve.
- **`paths`**: about 330 operations. Each has an `operationId`, a single tag equal to its `x-module`, an
  `x-required-access`, and a `4XX` response.
- **`components.schemas`**: records and request bodies. Engine outputs are referenced from
  `contracts/engines/` with `$ref`, not repeated.
- **`components.securitySchemes`**: `oidcBearer` (an OIDC access token) and `demoSession` (the signed demo cookie
  `opendispatch_demo_session`).

### Conventions

- **Context comes from the server.** No operation takes a tenant, customer, role or request context from the caller.
  `pnpm validate:contracts` refuses parameters named `tenant`, `tenant_id`, `customer`, `customer_id`, `role` or
  `context`. A managed user's role is `assigned_role`.
- **Records** are `allOf: [BaseRecord, {...}]`: `id`, `tenant_id`, `created_at`, `updated_at`, `created_by`,
  `data_source`, plus `extra` for source-specific fields. Responses reject unknown properties
  (`unevaluatedProperties: false`); request bodies too (`additionalProperties: false`).
- **Request bodies** have their own `*Write`, `*Create` or `*Update` schemas. `PUT` replaces, `PATCH` changes some fields.
- **Time.** Timestamps are ISO 8601 with an offset, `+03:00` by convention. Dates are `YYYY-MM-DD`, times of day `HH:MM`.
- **Lists** are cursor paginated: `limit` (default 50, at most 200) and `cursor`; the response has `items` and `page`.
  Bounded views (a 96-interval day, a day of gap cells) are not paginated.
- **Errors** use `ApiError`: a stable `code` (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
  `CONFLICT`, `SELF_APPROVAL_FORBIDDEN`, `ENGINE_UNAVAILABLE`, `STORAGE_UNAVAILABLE`, `ASSISTANT_OFF` and others), a
  plain-language `message`, an optional `request_id` to quote to support, and optional field-level `details`.
- **Both 10-minute readings** (from registration and from assignment) are always returned; a setting chooses which
  is shown first.

## Permissions

Every operation carries two extension fields, and the api checks both on every call
(`apps/api-go/internal/reqctx/guard.go`, `apps/api-go/internal/access`).

| Field | Meaning |
|---|---|
| `x-module` | The module the operation belongs to, one of the ids in `x-modules` |
| `x-required-access` | `view` (needs `view` or `edit` on that module) or `edit` (needs `edit`) |
| `x-approval: true` | An approve or reject operation. Needs the caller's role in the module's `approvers`, not `edit`. Nobody approves their own request (`SELF_APPROVAL_FORBIDDEN`) |
| `x-install-modes` | The operation exists only in these install modes (for example `[private]`) |
| `x-keycloak-side: true` | The state lives in Keycloak or the update agent; the api passes it through |
| `x-demo-only: true` | Demo mode only (reset, replay controls, simulated outages, demo sign-in). Not registered in OIDC mode |

Roles: `administrator`, `dispatch_supervisor`, `dispatcher`, `planner`, `remote_team_lead`, `viewer_auditor` and
`change_approver` (private installs only). A role's access to a module comes from `x-modules`; for example the
Live Dispatch Board is `edit` for dispatchers and supervisors and `view` for planners. Approvers: rosters and
overrides and classification rules, the dispatch supervisor; leave, the planner; updates, the change approver.

On top of the module check, **zone scope** limits every list and write: dispatch supervisors, dispatchers and
planners see and change only their assigned zones; the remote team lead works on the remote pool; the other roles
cover the whole install. Roles come from the user's identity-provider groups through the tenant's group rules
(`role_mappings`), never from the token directly.

The full matrix, with install-mode differences, is in
[`apps/web/src/lib/access/README.md`](../apps/web/src/lib/access/README.md). A Go test checks the api's matrix against
`x-modules`, and `pnpm validate:contracts` checks `x-modules` against its own copy of the matrix.

## Feeds

`contracts/feeds.openapi.yaml` is separate because its callers are systems, not users. Each request is signed:
`X-Feed-Key-Id` names a key, `X-Feed-Timestamp` is Unix seconds within five minutes of the server clock, and
`X-Feed-Signature` is the lowercase hex HMAC-SHA256 of `timestamp + "." + body` with that key's secret. The tenant is
the key's tenant. Events are idempotent by `idempotency_key`, may arrive out of order (an older case update is kept
as `stale` and changes nothing), and get `202` once stored. During maintenance the api answers `503` with
`Retry-After`.

## Render the reference

```sh
pnpm install
pnpm exec redocly build-docs contracts/openapi.yaml -o openapi.html
pnpm exec redocly build-docs contracts/feeds.openapi.yaml -o feeds.html
```

Open the HTML files in a browser. Tags group operations by module; the `x-displayName` of each tag is its menu
name. Any other OpenAPI 3.1 viewer works as well.

## Change the contract

```sh
pnpm validate:contracts         # lint, strict schema compile, $ref resolution, examples, operation rules
pnpm generate:types             # regenerate apps/web/src/lib/types/
pnpm generate:types --check     # fail if the generated types are out of date
```

Then implement the operation in `apps/api-go/internal/httpapi` and `internal/business`, and call it from the web
app's data layer. Additive changes (a new optional field, a new operation) are the norm. Record shapes are closed,
so a new response field is a contract change for every client built on the generated types. See
[`contracts/README.md`](../contracts/README.md).
