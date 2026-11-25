# Data model

All state is in one PostgreSQL 16 database. The schema is created only by the migrations in
`apps/api-go/migrations/` (see [their README](../apps/api-go/migrations/README.md)). Record shapes are the component
schemas of `contracts/openapi.yaml`.

## Tenancy

One database can hold many tenants. Isolation is enforced by PostgreSQL, not by application code alone.

- Every customer table has `tenant_id uuid NOT NULL` and a primary key `(tenant_id, id)`. Foreign keys include
  `tenant_id`, so a row can only point at rows of its own tenant.
- Every customer table has row-level security enabled and **forced** (it applies to the table owner too), with one
  policy for reads and writes:

  ```sql
  ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
  ALTER TABLE cases FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON cases
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  ```

- The api and worker connect as an **application role** (`NOSUPERUSER NOBYPASSRLS`). Every transaction starts with
  `SELECT set_config('app.tenant_id', $1, true)` (`internal/tenancy/with_tenant.go`). Without it, the setting is
  empty and the cast fails, so a query cannot read across tenants by mistake.
- The **owner role** (with `BYPASSRLS`) is used only to apply migrations and, in demo mode with test routes on, to
  reset the database. On an install only the migration job gets it.
- The tenant of a request comes from the signed-in session: the OIDC token's issuer and, in a shared install, its
  organisation, matched against `OPENDISPATCH_OIDC_TENANTS_FILE`. No operation accepts a tenant from the caller.

Tables without `tenant_id` are the migration bookkeeping (`opendispatch_meta.schema_migrations`) only.

## Data source labels

Every record carries `data_source`:

| Value | Meaning |
|---|---|
| `SYNTHETIC` | Made by the generator, the demo tools or a demo or test install |
| `IMPORTED` | Loaded from a file through Data Import and Quality |
| `LIVE` | Received from a live feed, or made in the app on a real install |

Records made in the app (settings, rules, rosters, overrides, leave, scenarios, audit events) take the install's
`OPENDISPATCH_RECORD_DATA_SOURCE` (`SYNTHETIC` by default, `LIVE` on a real install). Imports keep `IMPORTED`. Feed
events take the `data_source` of the signing key. Weather days may also be `PUBLIC_OPEN_DATA`.

When a screen or an engine output draws on more than one source, `input_data_sources` lists them and the screen says
so. Engine outputs set `illustrative: true` unless every input is real.

## Tables

Grouped by purpose. Each is in the migration of the same name.

| Area | Tables |
|---|---|
| Locations | `cities`, `zones` (dispatch zones), `sub_zones` (forecast areas, with a centre point), `standby_points` |
| People and fleet | `agents` (field or remote), `agent_skills`, `agent_shift_eligibility`, `vehicles`, `vehicle_maintenance`, `leave_requests`, `sick_leave_history`, `attendance_spans` |
| Reference and rules | `case_types`, `classification_rules`, `rule_versions`, `shift_patterns`, `break_rules`, `holidays`, `prayer_times`, `settings`, `notification_rules`, `integrations` |
| Cases | `cases`, `remote_reviews` |
| Imports | `import_jobs`, `import_mappings`, `import_case_snapshots` (for rollback), `data_quality_issues` |
| Feeds and live state | `feed_events`, `agent_status_history`, `agent_live_state` |
| Forecasts | `forecast_runs`, `forecast_values` (a TimescaleDB hypertable when the extension is available), `model_versions`, `forecast_experiments`, `forecast_accuracy_rollups`, `forecast_accuracy_hour_totals`, `weather_days`, `engine_answers` |
| Rosters and planning | `rosters`, `roster_assignments`, `overrides`, `approvals`, `scenarios`, `simulation_runs`, `simulation_results` |
| Live assignment | `assignments` (at most one active per case), `assignment_events`, `assignment_comparisons` (OpenDispatch's pick against the actual one) |
| Reporting | `dashboard_rollups`, `productivity_rollups` |
| Access and integration | `users`, `role_mappings` (identity-provider group to role), `sessions`, `identity_providers`, `api_clients`, `webhooks`, `webhook_deliveries` |
| Operations and audit | `audit_events` (append only), `notifications`, `job_runs`, `diagnostics_bundles`, `control_evidence`, `support_access_events` |

Common columns on persisted records: `id`, `tenant_id`, `created_at`, `updated_at`, `created_by` (null for the
system), `data_source`, and `extra` (`jsonb`) for fields a source has that the model does not. `sessions`,
`feed_events`, `agent_status_history`, `agent_live_state` and `diagnostics_bundles` carry `tenant_id` but no
`data_source`.

### Cases

A case is one request for field or remote work. The columns that matter most:

| Column | Notes |
|---|---|
| `external_id` | The source system's id; unique per tenant when present |
| `case_number` | Human-readable number |
| `registered_at`, `assigned_at`, `arrived_at`, `closed_at` | The four times the service-level readings use |
| `city_id`, `zone_id`, `sub_zone_id`, `latitude`, `longitude` | Location; joins are by id |
| `case_type_id`, `parties_involved`, `severity` | Attributes used by classification rules |
| `handling` | `field` or `remote_inferred` (see the import rules below) |
| `agent_id`, `vehicle_id` | Who handled it, when known |

### Forecasts

`forecast_runs` records each run: model and engine version, horizon, range coverage, status, `illustrative` and the
input data sources.
`forecast_values` holds one row per run, sub-zone and 15-minute interval with `low`, `expected`, `high` and the field
and remote split. With TimescaleDB it is a hypertable on `interval_start`; without the extension, or with
`opendispatch.timescaledb=off`, migration 0065 leaves it a plain table and everything still works.

### Audit

Every change made through the api writes an `audit_events` row in the same transaction as the change: actor type and
user, action, entity, outcome, a summary and a detail that holds the old and new values. The table refuses updates and deletes.

## Case import format: `generic_csv_v1`

Cases are imported from one CSV layout, defined in `config/mappings/generic_csv_v1.json`. A different export layout
is a new mapping version (for example `generic_csv_v2.json`) or a mapping saved in Admin, not a code change.

**File.** CSV, one header row, one case per row. Timestamps are ISO 8601 with an offset, or
`YYYY-MM-DD HH:MM:SS` read as local time in `Asia/Riyadh`. References join on the external ids of the reference data
(`cities.external_id` and so on), never on names.

### Columns

| Column | Field | Type | Required | Notes |
|---|---|---|---|---|
| `RecordID` | `external_id` | string | yes | The source system's id, unique per tenant. Stored ids are UUIDs, so ids of different tenants never collide |
| `CaseNumber` | `case_number` | string | yes | Unique. The first two letters are the city code (`RD`, `JD`, `DM` in the sample data) |
| `RegisteredTime` | `registered_at` | datetime | yes | |
| `CityID` | `city_id` | reference to `cities.external_id` | yes | |
| `CityNameEn` | `cities.name_en` | string | no | Informational, never joined on |
| `ZoneID` | `zone_id` | reference to `zones.external_id` | yes | The dispatch zone |
| `ZoneNameEn` | `zones.name_en` | string | no | Informational |
| `SubZoneID` | `sub_zone_id` | reference to `sub_zones.external_id` | yes | The forecast area |
| `SubZoneNameEn` | `sub_zones.name_en` | string | no | Informational |
| `Latitude` | `latitude` | number, -90 to 90 | yes | |
| `Longitude` | `longitude` | number, -180 to 180 | yes | |
| `CaseTypeID` | `case_type_id` | reference to `case_types.external_id` | yes | |
| `CaseTypeNameEn` | `case_types.name_en` | string | no | For example Standard case, Police attended, Unlisted |
| `PartyCount` | `parties_involved` | integer, 0 or more | yes | 0 and 1 are valid but reported as warnings |
| `AssignedTime` | `assigned_at` | datetime | no | Empty for cases handled remotely. Earlier than registration is a warning, not an error |
| `ArrivalTime` | `arrived_at` | datetime | no | |
| `ClosingTime` | `closed_at` | datetime | no | For remote cases, the end of the review |
| `ClaimAmount` | `extra.claim_value_sar` | number, 0 or more | no | Classification rule criterion, kept in `extra`, read on new cases only |
| `AssessmentMethod` | `extra.damage_assessment_method` | `photo`, `video`, `in_person` | no | Classification rule criterion |
| `LocationType` | `extra.location_type` | `dense_urban`, `urban`, `suburban`, `highway`, `rural` | no | Classification rule criterion |
| `CustomerPreference` | `extra.customer_preference` | `none`, `remote`, `field` | no | Classification rule criterion |
| `Severity` | `severity` | `minor`, `moderate`, `severe` | no | Any other value is a warning and the case is imported without one |
| `ResolutionMethod` | `resolution_method` | `field`, `remote` | no | When present it sets `handling`, and is kept in `extra.resolution_method` |

**Derived.** `handling` is `field` or `remote_inferred`: from `ResolutionMethod` when present (`remote` becomes
`remote_inferred`), otherwise `field` when `AssignedTime` is present and `remote_inferred` when it is not. Screens show
it as inferred.

**Not in the file.** `agent_id`, `vehicle_id`, `injury_present`, `estimated_damage_sar`, `on_scene_completed_at`,
`remote_review_at` and `channel` stay empty for imported cases.

**Service area.** Latitude 16 to 33, longitude 34 to 56: the bounding box of the sample geography. A point outside is a
warning and the case keeps it. Change the box in the mapping for another region.

### Validation

| Issue | Severity | When |
|---|---|---|
| `missing_required_field` | error | A required column is empty, or missing from the header |
| `unknown_reference` | error | `CityID`, `ZoneID`, `SubZoneID` or `CaseTypeID` is not in the reference data |
| `out_of_range_coordinate` | error | Latitude or longitude outside its valid range |
| `out_of_range_coordinate` | warning | Valid, but outside the service area |
| `duplicate_external_id` | warning | `RecordID` appears more than once |
| `assigned_before_registered` | warning | `assigned_at` earlier than `registered_at` |
| `unusual_parties_count` | warning | `parties_involved` is 0 or 1 |
| `inconsistent_name_case` | info | A name differs from its earlier spelling only in capitals |
| `other` | warning | A point more than 100 km from its sub-zone centre |
| `other` | warning | `Severity` or `ResolutionMethod` not one of its allowed values |
| `other` | warning | Registered more than a day in the future, or arrived or closed before registration |
| `other` | warning | Arrival more than 24 hours, or closing more than 30 days, after registration |
| `other` | warning | A registration day (not the first or last of the file) with more than 3 times, or under a third of, the median cases per day, given at least 7 days and a median of 10 (a missing or doubled extract) |

### Cleaning rules

| Rule | Applies to | Action |
|---|---|---|
| `errors_skip_row` | Rows with an error | Not imported; the issue stays listed against the import job |
| `duplicates_first_wins` | Duplicate `RecordID` | The first row without errors is imported; later copies are skipped |
| `warnings_keep_row` | Rows with only warnings or notes | Imported unchanged. Nothing is guessed or filled in |
| `unknown_values_dropped` | `Severity` or `ResolutionMethod` outside the allowed values | Imported without that value; `handling` falls back to the assigned-time rule |
| `names_by_id` | Name columns | Ids are used; names are never joined on |
| `timestamps_local` | Datetime columns | ISO 8601, or `YYYY-MM-DD HH:MM:SS` as local time |
| `escalate_to_data_owner` | Any error or warning | One notification per validated import to the data owner role (setting `imports.data_owner_role`, default administrator): critical with errors, warning otherwise; audited as `import.quality_escalated` |

### Example

[`docs/examples/cases_example.csv`](examples/cases_example.csv) has four invented rows that match the synthetic
reference data in `fixtures/locations/` and `fixtures/reference/`:

```csv
RecordID,CaseNumber,RegisteredTime,CityID,CityNameEn,ZoneID,ZoneNameEn,SubZoneID,SubZoneNameEn,Latitude,Longitude,CaseTypeID,CaseTypeNameEn,PartyCount,AssignedTime,ArrivalTime,ClosingTime,ClaimAmount,AssessmentMethod,LocationType,CustomerPreference,Severity,ResolutionMethod
EX-000001,RD-260920-00001,2026-09-20 08:14:00,101,Riyadh,2001,Riyadh Central,30001,Amber Terrace,24.7118,46.6301,1,Standard case,2,2026-09-20 08:17:00,2026-09-20 08:29:00,2026-09-20 08:44:00,4200,photo,dense_urban,none,minor,field
EX-000002,RD-260920-00002,2026-09-20T09:02:30+03:00,101,Riyadh,2002,Riyadh North,30013,Mesa Grove,24.8001,46.6195,2,Police attended,3,2026-09-20T09:05:10+03:00,2026-09-20T09:16:40+03:00,2026-09-20T09:41:00+03:00,12500,in_person,urban,field,moderate,
EX-000003,JD-260920-00001,2026-09-20 10:47:00,102,Jeddah,2006,Jeddah North,30067,Umber Court,21.6101,39.1089,1,Standard case,2,,,2026-09-20 11:20:00,1800,video,suburban,remote,minor,remote
EX-000004,DM-260920-00001,2026-09-20 22:31:00,103,Dammam,2008,Dammam Central,30098,Nova Point,26.4325,50.0218,3,Unlisted,2,2026-09-20 22:34:00,2026-09-20 22:47:00,2026-09-20 23:05:00,,,,,,
```

Row 2 uses offset timestamps and leaves `ResolutionMethod` empty, so its handling comes from `AssignedTime` (field).
Row 3 is a remote case. Row 4 leaves every optional column empty.

### Import steps

1. Upload the file: `uploadImport` for a single request, or the chunked upload (`createImportUpload`,
   `putImportUploadChunk`, `completeImportUpload`) for large files. The file goes to the S3-compatible store; the
   largest multipart upload is `OPENDISPATCH_IMPORT_MAX_BYTES` (2 GiB by default).
2. `validateImport` applies the rules above and lists issues (`listImportIssues`).
3. `compareImport` and `dryRunCutover` show what would change.
4. `executeCutover` writes the cases with `data_source: IMPORTED`. Rows with an existing `RecordID` update that case.
5. `rollbackImport` restores the cases a cut-over changed, from `import_case_snapshots`.

Each step is audited. If the header does not match, the assistant (when on) can suggest a column mapping, which a
person saves as a new mapping version.

Locations and agents have their own simpler CSV imports in Admin (all rows valid or nothing is written); sample files
are in `apps/web/public/samples/`.
