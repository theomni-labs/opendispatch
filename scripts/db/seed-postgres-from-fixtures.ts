// SPDX-License-Identifier: AGPL-3.0-only
// Seeds the database tables from the same fixtures.
//
//   pnpm seed:postgres
//   pnpm seed:postgres -- --reset
//
// Idempotent: safe to re-run, upserts by id.
// --reset: truncates first, back to the baseline.

import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const ROOT = path.join(import.meta.dirname, '../..');
const FIXTURES_DIR = path.join(ROOT, 'fixtures');

// schema (manifest.json) to real table, FK order.
// users/forecast_runs: seeded for FK integrity only.
const SCHEMA_TO_TABLE: ReadonlyArray<readonly [string, string]> = [
  ['City', 'cities'],
  ['PrayerTime', 'prayer_times'],
  ['Zone', 'zones'],
  ['SubZone', 'sub_zones'],
  ['BreakRule', 'break_rules'],
  ['CaseType', 'case_types'],
  ['User', 'users'],
  ['ClassificationRule', 'classification_rules'],
  ['RuleVersion', 'rule_versions'],
  ['RoleMapping', 'role_mappings'],
  ['Setting', 'settings'],
  ['Integration', 'integrations'],
  ['NotificationRule', 'notification_rules'],
  ['Notification', 'notifications'],
  ['AuditEvent', 'audit_events'],
  ['ForecastRun', 'forecast_runs'],
  ['ModelVersion', 'model_versions'],
  ['ForecastValue', 'forecast_values'],
  ['Vehicle', 'vehicles'],
  ['Agent', 'agents'],
  ['AgentSkill', 'agent_skills'],
  ['StandbyPoint', 'standby_points'],
  ['DashboardRollup', 'dashboard_rollups'],
  ['ProductivityRollup', 'productivity_rollups'],
  ['ShiftPattern', 'shift_patterns'],
  ['Holiday', 'holidays'],
  ['LeaveRequest', 'leave_requests'],
  ['Roster', 'rosters'],
  ['RosterAssignment', 'roster_assignments'],
  ['Override', 'overrides'],
  ['Approval', 'approvals'],
  ['Scenario', 'scenarios'],
  ['SimulationRun', 'simulation_runs'],
  ['SimulationResult', 'simulation_results'],
  ['Case', 'cases'],
  ['Assignment', 'assignments'],
  ['AssignmentEvent', 'assignment_events'],
  ['AssignmentComparison', 'assignment_comparisons'],
  ['ImportJob', 'import_jobs'],
  ['DataQualityIssue', 'data_quality_issues'],
];

interface ManifestFile {
  readonly path: string;
  readonly schema: string;
  readonly kind: string;
}

interface Manifest {
  readonly tenant_id: string;
  readonly files: readonly ManifestFile[];
}

function loadManifest(): Manifest {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'manifest.json'), 'utf8')) as Manifest;
}

function rowsFor(manifest: Manifest, schema: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const file of manifest.files) {
    if (file.schema !== schema) continue;
    const text = fs.readFileSync(path.join(FIXTURES_DIR, file.path), 'utf8');
    rows.push(...(JSON.parse(text) as Record<string, unknown>[]));
  }
  return rows;
}

async function jsonbColumns(sql: postgres.Sql, table: string): Promise<Set<string>> {
  const rows = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND data_type = 'jsonb'
  `;
  return new Set(rows.map((r) => r.column_name));
}

// Hypertable keys include the time column
async function primaryKeyColumns(sql: postgres.Sql, table: string): Promise<string[]> {
  const rows = await sql<{ attname: string }[]>`
    SELECT a.attname FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = ${'public.' + quoteIdent(table)}::regclass AND i.indisprimary
    ORDER BY array_position(i.indkey::int2[], a.attnum)
  `;
  return rows.map((r) => r.attname);
}

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

async function seedTable(sql: postgres.Sql, table: string, rows: readonly Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) {
    console.log(`  ${table}: no fixture rows, skipped`);
    return;
  }
  const jsonb = await jsonbColumns(sql, table);
  const key = await primaryKeyColumns(sql, table);
  let written = 0;
  // One insert per row: rows carry different keys.
  for (const [index, fixtureRow] of rows.entries()) {
    // Fixture files give every row of a table the identical created_at
    // (e.g. every Zone: "2026-09-05T20:00:00+03:00"). The api's list
    // route orders by (created_at, id) for stable keyset pagination; a
    // real per-row tie broke by a random uuid, not file order, which
    // is what "the first zone is Riyadh Central" (and similar) screen
    // defaults depend on. Nudging created_at forward by the row's own
    // position in the file (milliseconds - never a meaningful change
    // to anything that reads the date/hour) makes every seeded row's
    // created_at unique and file-order-preserving, so id never has to
    // break a real tie for seeded data.
    const row: Record<string, unknown> =
      typeof fixtureRow['created_at'] === 'string'
        ? { ...fixtureRow, created_at: new Date(Date.parse(fixtureRow['created_at'] as string) + index).toISOString() }
        : fixtureRow;
    // settings.value is text: the JSON of the fixture value.
    if (table === 'settings') row['value'] = JSON.stringify(row['value']);
    // notifications.body_en is not null: no body is an empty one.
    if (table === 'notifications') row['body_en'] = row['body_en'] ?? '';
    const cols = Object.keys(row);
    // ::jsonb self-stringifies; stringifying doubles it.
    const values = cols.map((c) => (jsonb.has(c) ? row[c] ?? {} : row[c]));
    const placeholders = cols.map((c, i) => `$${String(i + 1)}${jsonb.has(c) ? '::jsonb' : ''}`);
    const updateSet = cols
      .filter((c) => !key.includes(c))
      .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`);
    const query = `
      INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (${key.map(quoteIdent).join(', ')}) ${table === 'audit_events' ? 'DO NOTHING' : `DO UPDATE SET ${updateSet.join(', ')}`}
    `;
    await sql.unsafe(query, values as never[]);
    written += 1;
  }
  console.log(`  ${table}: ${String(written)} rows`);
}

async function resetTables(sql: postgres.Sql): Promise<void> {
  const tables = SCHEMA_TO_TABLE.map(([, table]) => quoteIdent(table)).join(', ');
  await sql.unsafe(`TRUNCATE ${tables} CASCADE`);
  console.log(`Reset: truncated ${String(SCHEMA_TO_TABLE.length)} tables.`);
}

async function main(): Promise<void> {
  const url = process.env['OPENDISPATCH_MIGRATION_DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('OPENDISPATCH_MIGRATION_DATABASE_URL is not set.');
  const manifest = loadManifest();
  console.log(`Seeding tenant ${manifest.tenant_id} from fixtures/manifest.json`);
  const sql = postgres(url, { max: 1 });
  try {
    if (process.argv.includes('--reset')) await resetTables(sql);
    for (const [schema, table] of SCHEMA_TO_TABLE) {
      await seedTable(sql, table, rowsFor(manifest, schema));
    }
  } finally {
    await sql.end();
  }
  console.log('Done.');
}

await main();
