# Migrations

The only way the database schema changes. Applied by `apps/api-go/internal/tenancy/migration_runner.go`, from the
api at start (`OPENDISPATCH_MIGRATE_ON_START=1`, the default) or from `cmd/migrate` as a Kubernetes Job.

## Naming

`NNNN_description.sql`, zero-padded, so filename order is apply order. Numbers may skip; they never repeat.

## Header

Every file starts with three SQL comment lines, each `true` or `false`:

```sql
-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false
```

When `requires_restore_to_rollback` is `true`, a fourth line gives the reason:

```sql
-- requires_restore_to_rollback: true
-- reason: dropping the old column needs the table rewritten
```

The header ends at the first line that is not a `-- key: value` comment. A missing or malformed field fails the
whole run before anything is applied (`migration_header.go`).

| Field | What the runner does |
|---|---|
| `needs_downtime` | Recorded and returned per migration, so deployment tooling can warn before running. Not a gate |
| `non_transactional` | `true` runs the SQL without `BEGIN`/`COMMIT`, for statements PostgreSQL refuses in a transaction (`CREATE INDEX CONCURRENTLY`). `false`, the usual case, runs the whole file in one transaction |
| `requires_restore_to_rollback` | Not enforced; it puts the reason on record. Changes follow expand, then contract, so this is rare, and never acceptable for a shared install |

## Every customer table

The migration that creates a customer table also gives it `tenant_id uuid NOT NULL`, the primary key
`(tenant_id, id)`, foreign keys that include `tenant_id`, and the row-level security shape of
`internal/tenancy/policy.go`:

```sql
ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "<table>"
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

Generate it with `TenantIsolationSQL` or copy it exactly. `internal/tenancy/migrations_lint_test.go` checks the file
conventions. Most persisted records also carry `data_source`, `created_at`, `updated_at`, `created_by` and an
`extra jsonb`.

## Applying

The runner connects as the **owner** role, which has `BYPASSRLS` because forced row-level security applies to the
owner too. It records each applied file in `opendispatch_meta.schema_migrations` (filename, sha256 of the file,
time) under a PostgreSQL advisory lock, so two runs cannot apply the same file.

**Never edit a migration after it is committed.** Editing an applied file is refused (`MigrationChecksumError`); add a
new migration instead.

## TimescaleDB

`0065_forecast_values_hypertable.sql` turns `forecast_values` into a hypertable when TimescaleDB is installed and
preloaded. Without it, or with `opendispatch.timescaledb=off`, the table stays plain and the migration logs a notice.
Use the Apache-2.0 `-oss` build of TimescaleDB.

## Tests

```sh
OPENDISPATCH_TEST_DATABASE_URL=postgres://opendispatch_owner:...@127.0.0.1:5432/opendispatch_test \
  go test ./internal/tenancy/...
```

The live tests apply the migrations and check that every table in the `public` schema has `tenant_id`, forced row-level
security and the `tenant_isolation` policy, and that a query with no tenant set fails instead of returning rows.
