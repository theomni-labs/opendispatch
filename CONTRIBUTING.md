# Contributing to OpenDispatch

Thank you for your interest. This guide covers how to set up a development environment, the checks a
change must pass, the engineering rules the code base follows, and the contributor licence agreement.

## Before you start

- For a bug, open an issue with the bug template. For a larger change, open a feature request or a
  discussion first, so we can agree on the approach before you write the code.
- Security problems are never reported in public issues. See [SECURITY.md](SECURITY.md).
- Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Development setup

You need Docker, Node.js 22 with pnpm 10 (`corepack enable`), Go 1.27 and Python 3.12. The versions are
pinned in `.tool-versions` and `.nvmrc`. A devcontainer in `.devcontainer/` has all of them.

```sh
pnpm install          # Node dependencies for the web app and the tooling
make dev              # web app on fixture data, http://127.0.0.1:3000
make demo             # the full stack in docker compose, synthetic data
make test             # unit tests: Node, Go and the Python engines
make lint             # ESLint, Stylelint, gofmt, go vet, contracts
```

See [docs/getting-started.md](docs/getting-started.md) for the details of each mode.

## Checks a change must pass

CI runs all of these on every pull request. Run them locally first:

| Check | Command |
| --- | --- |
| Type check | `pnpm typecheck` |
| Lint | `make lint` |
| Web and tooling unit tests | `pnpm test:pure` |
| Go tests | `cd apps/api-go && go test ./...` |
| Engines tests | `cd engines && python -m pytest` |
| Contracts | `pnpm validate:contracts` |
| Fixtures are up to date | `pnpm generate:fixtures && git diff --exit-code fixtures` |
| Secrets | `gitleaks dir .` |
| Word list | `bash scripts/ci/denylist.sh` |

Tests that need PostgreSQL skip themselves without `OPENDISPATCH_TEST_DATABASE_URL`. To run them, start the
database from the compose file and set the variable (see `docs/getting-started.md`).

Never weaken, skip or delete a test to make a check pass. Fix the code, or explain in the pull request why the
test itself was wrong.

## Engineering rules

Code comments refer to these rules by name, for example "the operator fallback rule". They hold everywhere.

### Data

1. **Data-layer boundary.** Screens get data only through the server-side functions in `apps/web/src/lib/data/`. Nothing outside that
   folder imports fixtures, the demo store or the api client. An ESLint rule enforces this and must stay on.
2. **Server-built context.** Every data function takes a request context (tenant, user, role, zone scope) as its first argument. The
   context is always built on the server, from the session. Server actions and route handlers never accept a
   context, tenant or role from the browser.
3. **Data-source label.** Every record carries `data_source` (`SYNTHETIC`, `IMPORTED` or `LIVE`). Every screen that shows records
   shows a data-source badge, and says so when it mixes sources.
4. **No-real-data.** Real operational data never enters this repository. It is loaded at runtime from a path or an upload.
   `.gitignore` covers `/data/`, `.demo-state/`, `*.xlsx`, and `*.csv` outside the fixtures and samples.
5. **Calibration-only generator.** The synthetic generator reads only `scripts/synthetic/calibration.json`. Every value there is invented and
   labelled `assumption`.
6. **Inferred handling.** Handling is `field` or `remote_inferred` unless the source system supplies an explicit field. Screens show
   "inferred".
7. **Illustrative figures.** A figure computed from synthetic data carries an "Illustrative" label. The 10-minute response measure is
   always shown two ways, from registration and from assignment; which one is primary is a setting.
8. **Assumptions-as-settings.** Operational assumptions are settings or clearly isolated code, so a different answer is a configuration
   change, not a rewrite.

### Tenancy

9. **Tenant table.** Every tenant table (every table outside the `platform` schema) has `tenant_id`, the primary key
   `(tenant_id, id)`, row-level security enabled and forced, and a policy allowing only rows where
   `tenant_id = current_setting('app.tenant_id')::uuid`. Every foreign key is the pair `(tenant_id, other_id)`.
   A TimescaleDB hypertable has the primary key `(tenant_id, id, <time column>)` and no foreign keys point at it.
10. **Tenant-from-token.** The tenant comes from the token (issuer and organisation), matched against `platform.tenants`. Unknown
    issuers are refused. The tenant never comes from request input.
11. **Tenant-per-transaction.** The tenant is set only by the tenancy package, inside each transaction (`set_config('app.tenant_id', ...,
    true)`), never at session level. A query with no tenant set fails, on a fresh and on a pooled connection.
12. **Application role.** The api and worker connect as the application role, which owns no tables and lacks `BYPASSRLS`. Only the
    migration runner uses the owner role.
13. **No-definer-functions.** Views use `security_invoker`. No `SECURITY DEFINER` functions over tenant tables, no materialized views.
    Every index and unique constraint starts with `tenant_id`.
14. **Configuration-not-tables.** Tenants differ by configuration, never by tables: settings, rules or the `extra` JSONB column.

### Database changes

15. **Migrations-only.** Every change is a versioned migration in `apps/api-go/migrations/`, data fixes too. A migration is never
    edited after it is released.
16. **Row-level security.** A new tenant table gets `tenant_id`, the `(tenant_id, id)` key, forced row-level security and its policy in
    the same migration. A test fails the build otherwise. Each migration starts with the comment header the
    runner reads (`needs_downtime`, `non_transactional`, `requires_restore_to_rollback` with a reason).
17. **Expand-then-contract.** Migrations follow expand, then contract: the previous release must still run on the migrated database.
18. **Restore-to-rollback.** Set `requires_restore_to_rollback` only when unavoidable, with the reason.

### Live assignment

19. **Operator fallback.** OpenDispatch is never the only way a case gets assigned. The operator's own dispatch is always the
    fallback and takes over when OpenDispatch does not answer in time or its health checks fail. OpenDispatch
    never sends a second assignment for a case already assigned.
20. **Assignment source.** Every assignment records its source (OpenDispatch, the customer's fallback, or manual) and, for manual
    changes, a reason code. The stage per zone (shadow, recommend, automatic) is a setting.

### Security

21. **Api-enforced access.** Roles and zone scope are enforced by the api on every request. The demo role switcher only exists in demo
    mode.
22. **No default role.** A signed-in person whose groups match no role rule gets no access, never a default role.
23. **Identity provider.** SAML and OIDC are handled by the identity provider (Keycloak). This code base never parses SAML.
24. **No-secrets.** No secrets in code, fixtures, tests or logs. gitleaks must pass. Configuration comes from the environment.
25. **Audit-every-write.** Every write and every sign-in event goes to the audit log, with the actor.

### User interface

26. **UI components.** Use the components in `packages/ui` (built on Ant Design) and its theme tokens. No raw colour values in
    screen code.
27. **Calm screens.** Keep screens calm: few summary figures, few default table columns, few header actions, colour for status or
    category only.
28. **Screen states.** Every screen has its empty, loading, error and filled states, and a disabled state wherever an action can be
    unavailable to the current user.
29. **Bilingual RTL.** Arabic and English from the start. Right-to-left layout with logical CSS properties only. Dates through the
    shared formatter, with Hijri support. Western digits in both languages.
30. **Plain wording.** User-facing text is sentence case with plain verbs. A button says what it does.

## Code style

- Go: `gofmt`, `go vet`. Wrap errors with context, pass `context.Context` through request paths, no global
  mutable state outside tests.
- TypeScript: strict mode. No `any` without a comment that says why.
- Python: standard library style, type hints on public functions, `pytest` for tests.
- New source files start with an SPDX header: `SPDX-License-Identifier: AGPL-3.0-only`.
- Commit messages: one short summary line in the imperative or present tense, then a blank line and the why.
  We use [Conventional Commits](https://www.conventionalcommits.org/) prefixes (`feat:`, `fix:`, `docs:`) so
  release notes can be generated.

## Contributor licence agreement

OpenDispatch is offered under the AGPL-3.0 and, separately, under a commercial licence (see
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)). To keep that possible, every contributor signs the
[contributor licence agreement](CLA.md) once, as an individual or on behalf of an entity. You keep the copyright
in your contribution; the agreement gives Omni Labs the right to distribute it under both licences.

To sign, add this line to the description of your first pull request, with your name and email:

```text
I have read the OpenDispatch CLA (CLA.md, version 1.0) and I agree to it as an individual.
```

For an entity, write "on behalf of <entity name>" instead of "as an individual", and make sure you are
authorised to sign for it. We keep a record of signatures; you only sign once.

## Pull requests

- Keep a pull request to one purpose. Include tests for the behaviour you change.
- Fill in the template: what changed, why, how you tested it, and screenshots (English and Arabic) for UI
  changes.
- A maintainer reviews within a few working days. See [GOVERNANCE.md](GOVERNANCE.md) for how decisions are made.
