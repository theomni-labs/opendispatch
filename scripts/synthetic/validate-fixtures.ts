// SPDX-License-Identifier: AGPL-3.0-only
// Validates every committed fixture against its contract schema (scripts/contracts/schemas.ts) and checks integrity:
// unique ids, every foreign key resolves, every record is SYNTHETIC with the fixed tenant, every manifest entry exists
// and its count matches. Exits non-zero on any failure.
//
//   pnpm validate:fixtures

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEngineInvariants } from '../contracts/invariants';
import { createAjv, getComponentSchema, getEngineSchema, listComponentSchemas, listEngineSchemas } from '../contracts/schemas';
import { calibration } from './gen/calibration';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

interface ManifestEntry {
  path: string;
  schema: string;
  kind: 'array' | 'object';
  count: number;
  contract_schema?: string;
}

type Row = Record<string, unknown>;

export interface ValidationReport {
  readonly errors: string[];
  readonly counts: { schema: string; files: number; records: number }[];
}

/** Fixture-only shapes that no contract component describes. Built from contract pieces where possible. */
function replayScriptSchema(): object {
  const strip = (s: object): object => {
    const { $schema: _ignored, ...rest } = s as Record<string, unknown>;
    void _ignored;
    return rest;
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['replay_date', 'default_start_at', 'total_cases', 'data_source', 'events'],
    properties: {
      replay_date: { type: 'string', format: 'date' },
      default_start_at: { type: 'string', format: 'date-time' },
      total_cases: { type: 'integer', minimum: 0 },
      data_source: { const: 'SYNTHETIC' },
      note: { type: 'string' },
      events: {
        type: 'array',
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['at', 'kind', 'case_id', 'case_number', 'from_agent_id', 'request'],
              properties: {
                at: { type: 'string', format: 'date-time' },
                kind: { const: 'reassignment' },
                case_id: { type: 'string', format: 'uuid' },
                case_number: { type: 'string' },
                from_agent_id: { type: 'string', format: 'uuid' },
                request: strip(getComponentSchema('OverrideAssignmentRequest')),
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['at', 'kind', 'request'],
              properties: {
                at: { type: 'string', format: 'date-time' },
                kind: { const: 'feed_outage' },
                request: strip(getComponentSchema('FeedOutageRequest')),
              },
            },
          ],
        },
      },
    },
  };
}

function schemaFor(name: string): object {
  if (name === 'ReplayScript') return replayScriptSchema();
  if (listEngineSchemas().includes(name)) return getEngineSchema(name);
  if (listComponentSchemas().includes(name)) return getComponentSchema(name);
  throw new Error(`No contract schema named ${name}`);
}

/** Foreign keys: [schema, field, target schema]. A field may be a dotted path; `[]` marks an array of ids. Null is allowed. */
const FOREIGN_KEYS: readonly [string, string, string][] = [
  ['Zone', 'city_id', 'City'],
  ['SubZone', 'zone_id', 'Zone'],
  ['StandbyPoint', 'zone_id', 'Zone'],
  ['StandbyPoint', 'sub_zone_id', 'SubZone'],
  ['Case', 'city_id', 'City'],
  ['Case', 'zone_id', 'Zone'],
  ['Case', 'sub_zone_id', 'SubZone'],
  ['Case', 'case_type_id', 'CaseType'],
  ['Case', 'agent_id', 'Agent'],
  ['Case', 'vehicle_id', 'Vehicle'],
  ['Agent', 'home_zone_id', 'Zone'],
  ['Agent', 'default_vehicle_id', 'Vehicle'],
  ['Vehicle', 'zone_id', 'Zone'],
  ['AgentSkill', 'agent_id', 'Agent'],
  ['LeaveRequest', 'agent_id', 'Agent'],
  ['LeaveRequest', 'decided_by_user_id', 'User'],
  ['ShiftPattern', 'break_rule_id', 'BreakRule'],
  ['RuleVersion', 'rule_id', 'ClassificationRule'],
  ['RuleVersion', 'decided_by_user_id', 'User'],
  ['Approval', 'decided_by_user_id', 'User'],
  ['User', 'zone_ids[]', 'Zone'],
  ['RoleMapping', 'zone_ids[]', 'Zone'],
  ['ForecastValue', 'forecast_run_id', 'ForecastRun'],
  ['ForecastValue', 'zone_id', 'Zone'],
  ['ForecastValue', 'sub_zone_id', 'SubZone'],
  ['Roster', 'zone_id', 'Zone'],
  ['Roster', 'forecast_run_id', 'ForecastRun'],
  ['Roster', 'approved_by_user_id', 'User'],
  ['RosterAssignment', 'roster_id', 'Roster'],
  ['RosterAssignment', 'agent_id', 'Agent'],
  ['RosterAssignment', 'shift_pattern_id', 'ShiftPattern'],
  ['RosterAssignment', 'zone_id', 'Zone'],
  ['RosterAssignment', 'vehicle_id', 'Vehicle'],
  ['RosterAssignment', 'standby_point_id', 'StandbyPoint'],
  ['Override', 'roster_id', 'Roster'],
  ['Override', 'roster_assignment_id', 'RosterAssignment'],
  ['Override', 'decided_by_user_id', 'User'],
  ['Scenario', 'zone_ids[]', 'Zone'],
  ['Scenario', 'adjustments.headcount_delta[].zone_id', 'Zone'],
  ['Scenario', 'adjustments.shift_pattern_ids[]', 'ShiftPattern'],
  ['SimulationRun', 'roster_id', 'Roster'],
  ['SimulationRun', 'scenario_id', 'Scenario'],
  ['SimulationResult', 'simulation_run_id', 'SimulationRun'],
  ['SimulationResult', 'zone_id', 'Zone'],
  ['Assignment', 'case_id', 'Case'],
  ['Assignment', 'agent_id', 'Agent'],
  ['Assignment', 'decided_by_user_id', 'User'],
  ['AssignmentEvent', 'assignment_id', 'Assignment'],
  ['AssignmentEvent', 'case_id', 'Case'],
  ['AssignmentEvent', 'actor_user_id', 'User'],
  ['AssignmentComparison', 'case_id', 'Case'],
  ['AssignmentComparison', 'zone_id', 'Zone'],
  ['AssignmentComparison', 'opendispatch.agent_id', 'Agent'],
  ['AssignmentComparison', 'customer.agent_id', 'Agent'],
  ['Notification', 'recipient_user_id', 'User'],
  ['DataQualityIssue', 'import_job_id', 'ImportJob'],
  ['DataQualityIssue', 'case_id', 'Case'],
  ['PrayerTime', 'city_id', 'City'],
  ['AuditEvent', 'actor_user_id', 'User'],
  ['ReplayCase', 'city_id', 'City'],
  ['ReplayCase', 'zone_id', 'Zone'],
  ['ReplayCase', 'sub_zone_id', 'SubZone'],
  ['ReplayCase', 'case_type_id', 'CaseType'],
  ['ReplayCase', 'agent_id', 'Agent'],
  ['ReplayCase', 'vehicle_id', 'Vehicle'],
];

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

/** Values found at a dotted path with `[]` array steps. */
function valuesAt(row: unknown, pathExpr: string): unknown[] {
  let current: unknown[] = [row];
  for (const step of pathExpr.split('.')) {
    const isArray = step.endsWith('[]');
    const key = isArray ? step.slice(0, -2) : step;
    const next: unknown[] = [];
    for (const item of current) {
      if (item === null || typeof item !== 'object') continue;
      const v = (item as Row)[key];
      if (v === undefined) continue;
      if (isArray) {
        if (Array.isArray(v)) next.push(...v);
      } else next.push(v);
    }
    current = next;
  }
  return current;
}

const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/;
const ISO_ANY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function collectTimestamps(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    if (ISO_ANY.test(node)) out.push(node);
  } else if (Array.isArray(node)) node.forEach((n) => collectTimestamps(n, out));
  else if (node !== null && typeof node === 'object') Object.values(node as Row).forEach((n) => collectTimestamps(n, out));
}

/**
 * Rows that carry `from_registration` and `from_assignment` readings (simulation results, dashboard roll-ups) checked with
 * the simulator's own invariant: they are wrapped as zone service levels and handed to checkEngineInvariants.
 */
export function readingInvariantProblems(rows: readonly Row[]): string[] {
  const doc = {
    overall: { from_registration: { within_count: 0, case_count: 0, share: null }, from_assignment: { within_count: 0, case_count: 0, share: null } },
    zones: rows.map((r) => ({ service_level: { from_registration: r['from_registration'], from_assignment: r['from_assignment'] } })),
  };
  return checkEngineInvariants('simulator.output', doc);
}

export function validateFixtures(fixturesDir = path.join(repoRoot, 'fixtures')): ValidationReport {
  const errors: string[] = [];
  const err = (message: string): void => {
    errors.push(message);
  };
  const manifestPath = path.join(fixturesDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { errors: [`${manifestPath} does not exist. Run pnpm generate:fixtures.`], counts: [] };
  }
  const manifest = readJson(manifestPath) as { files?: ManifestEntry[]; tenant_id?: string };
  const entries = manifest.files ?? [];
  const tenantId = calibration.structure.customer.id.value;
  if (manifest.tenant_id !== tenantId) err(`manifest.json tenant_id is ${String(manifest.tenant_id)}, expected ${tenantId}`);

  // Manifest: every entry exists, count matches, no file on disk is missing from the manifest.
  const onDisk = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json') && full !== manifestPath) onDisk.add(path.relative(fixturesDir, full).split(path.sep).join('/'));
    }
  };
  walk(fixturesDir);
  const seenPaths = new Set<string>();
  const data = new Map<string, unknown>();
  for (const e of entries) {
    if (seenPaths.has(e.path)) err(`manifest lists ${e.path} twice`);
    seenPaths.add(e.path);
    const full = path.join(fixturesDir, e.path);
    if (!fs.existsSync(full)) {
      err(`manifest lists ${e.path}, which does not exist`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = readJson(full);
    } catch (error) {
      err(`${e.path}: not valid JSON (${(error as Error).message})`);
      continue;
    }
    data.set(e.path, parsed);
    if (e.kind === 'array') {
      if (!Array.isArray(parsed)) err(`${e.path}: manifest says array but the file is not an array`);
      else if (parsed.length !== e.count) err(`${e.path}: manifest count ${e.count}, file has ${parsed.length}`);
    } else {
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) err(`${e.path}: manifest says object but the file is not an object`);
      else if (e.count !== 1) err(`${e.path}: an object entry must have count 1, has ${e.count}`);
    }
  }
  for (const p of onDisk) if (!seenPaths.has(p)) err(`${p} is on disk but not in manifest.json`);

  // Schema validation.
  const counts = new Map<string, { files: number; records: number }>();
  const validators = new Map<string, ReturnType<ReturnType<typeof createAjv>['compile']>>();
  const validatorFor = (name: string): ReturnType<ReturnType<typeof createAjv>['compile']> => {
    let v = validators.get(name);
    if (v === undefined) {
      v = createAjv().compile(schemaFor(name));
      validators.set(name, v);
    }
    return v;
  };
  const MAX_ERRORS_PER_FILE = 3;

  for (const e of entries) {
    const parsed = data.get(e.path);
    if (parsed === undefined) continue;
    const contractName = e.contract_schema ?? e.schema;
    let validate: ReturnType<typeof validatorFor>;
    try {
      validate = validatorFor(contractName);
    } catch (error) {
      err(`${e.path}: cannot compile schema ${contractName}: ${(error as Error).message}`);
      continue;
    }
    const rows = e.kind === 'array' ? (parsed as unknown[]) : [parsed];
    const tally = counts.get(e.schema) ?? { files: 0, records: 0 };
    tally.files += 1;
    tally.records += rows.length;
    counts.set(e.schema, tally);
    let shown = 0;
    let failed = 0;
    rows.forEach((row, i) => {
      if (!validate(row)) {
        failed += 1;
        if (shown < MAX_ERRORS_PER_FILE) {
          shown += 1;
          const detail = (validate.errors ?? []).slice(0, 4).map((x) => `${x.instancePath || '/'} ${x.message ?? ''}${x.params && Object.keys(x.params).length > 0 ? ` ${JSON.stringify(x.params)}` : ''}`).join('; ');
          err(`${e.path} record ${i} (${e.schema}) fails ${contractName}: ${detail}`);
        }
      }
    });
    if (failed > shown) err(`${e.path}: ${failed} records fail ${contractName} (${shown} shown)`);
  }

  // Integrity: ids, tenant, data source, timestamps, foreign keys.
  const ids = new Map<string, Set<string>>();
  const addIds = (kind: string, row: Row): void => {
    const id = row['id'];
    if (typeof id !== 'string') return;
    const set = ids.get(kind) ?? new Set<string>();
    if (set.has(id)) err(`duplicate id ${id} in ${kind}`);
    set.add(id);
    ids.set(kind, set);
  };
  const rowsByKind = new Map<string, Row[]>();
  for (const e of entries) {
    const parsed = data.get(e.path);
    if (!Array.isArray(parsed)) continue;
    const kind = e.schema;
    const list = rowsByKind.get(kind) ?? [];
    for (const row of parsed as Row[]) {
      list.push(row);
      if (row !== null && typeof row === 'object' && 'tenant_id' in row) {
        addIds(kind, row);
        if (row['tenant_id'] !== tenantId) err(`${e.path}: ${kind} ${String(row['id'])} has tenant_id ${String(row['tenant_id'])}`);
        if (row['data_source'] !== 'SYNTHETIC') err(`${e.path}: ${kind} ${String(row['id'])} has data_source ${String(row['data_source'])}`);
      }
    }
    rowsByKind.set(kind, list);
  }
  // Replay cases are cases for reference purposes (ids must not collide with the week's).
  const caseIds = new Set<string>([...(ids.get('Case') ?? []), ...(ids.get('ReplayCase') ?? [])]);
  if (caseIds.size !== (ids.get('Case')?.size ?? 0) + (ids.get('ReplayCase')?.size ?? 0)) err('a ReplayCase id collides with a Case id');
  ids.set('Case', caseIds);

  // Engine objects: single-record kinds whose ids we do not track. Collect their references directly.
  const idSet = (kind: string): Set<string> => ids.get(kind) ?? new Set<string>();
  const checkRef = (where: string, kind: string, value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value !== 'string' || !idSet(kind).has(value)) err(`${where}: ${String(value)} is not a ${kind} id`);
  };
  const MAX_FK_ERRORS = 5;
  const fkErrors = new Map<string, number>();
  const withLimit = (rule: string, fn: () => void): void => {
    const before = errors.length;
    fn();
    const added = errors.length - before;
    if (added > 0) {
      const total = (fkErrors.get(rule) ?? 0) + added;
      fkErrors.set(rule, total);
      if (total > MAX_FK_ERRORS) errors.length = before + Math.max(0, MAX_FK_ERRORS - (total - added));
    }
  };
  for (const [schema, field, target] of FOREIGN_KEYS) {
    const rows = rowsByKind.get(schema) ?? [];
    withLimit(`${schema}.${field}`, () => {
      for (const row of rows) {
        for (const v of valuesAt(row, field)) checkRef(`${schema} ${String(row['id'])}.${field}`, target, v);
      }
    });
  }
  // created_by, everywhere.
  for (const [kind, rows] of rowsByKind) {
    withLimit(`${kind}.created_by`, () => {
      for (const row of rows) if (row['created_by'] !== undefined) checkRef(`${kind} ${String(row['id'])}.created_by`, 'User', row['created_by']);
    });
  }
  // Approval subjects.
  for (const row of rowsByKind.get('Approval') ?? []) {
    const target = row['subject_type'] === 'rule_version' ? 'RuleVersion' : row['subject_type'] === 'roster' ? 'Roster' : 'Override';
    checkRef(`Approval ${String(row['id'])}.subject_id`, target, row['subject_id']);
  }
  // Settings that hold zone stages.
  for (const row of rowsByKind.get('Setting') ?? []) {
    const value = row['value'] as Row | undefined;
    if (typeof row['key'] === 'string' && row['key'].startsWith('live_assignment.stage.') && value !== undefined) checkRef(`Setting ${row['key']}.value.zone_id`, 'Zone', value['zone_id']);
  }

  // Timestamps: every ISO date-time in every fixture carries +03:00.
  for (const e of entries) {
    const parsed = data.get(e.path);
    if (parsed === undefined) continue;
    const stamps: string[] = [];
    collectTimestamps(parsed, stamps);
    const bad = stamps.filter((s) => !ISO_OFFSET.test(s));
    if (bad.length > 0) err(`${e.path}: ${bad.length} timestamps without the +03:00 offset, e.g. ${bad[0]}`);
  }

  // The required structure.
  const zones = rowsByKind.get('Zone') ?? [];
  const cities = rowsByKind.get('City') ?? [];
  const wantZones = calibration.targets.zones_in_fixtures.value as Record<string, number>;
  for (const [code, want] of Object.entries(wantZones)) {
    const city = cities.find((c) => c['case_code'] === code);
    const have = zones.filter((z) => z['city_id'] === city?.['id']).length;
    if (have !== want) err(`city ${code} has ${have} zones, expected ${want}`);
  }
  const subZones = rowsByKind.get('SubZone') ?? [];
  for (const z of zones) {
    const n = subZones.filter((s) => s['zone_id'] === z['id']).length;
    const cfg = calibration.structure.sub_zones_per_zone;
    if (n < cfg.min || n > cfg.max) err(`zone ${String((z['extra'] as Row)['code'])} has ${n} sub-zones, expected ${cfg.min} to ${cfg.max}`);
  }
  const caseRows = rowsByKind.get('Case') ?? [];
  const seenNumbers = new Set<string>();
  const seenExternal = new Set<string>();
  for (const c of caseRows) {
    const num = String(c['case_number']);
    if (seenNumbers.has(num)) err(`duplicate case_number ${num}`);
    seenNumbers.add(num);
    const ext = String(c['external_id']);
    if (seenExternal.has(ext)) err(`duplicate external_id ${ext}`);
    seenExternal.add(ext);
    const field = c['handling'] === 'field';
    if (field !== (c['assigned_at'] !== null)) err(`case ${num}: handling ${String(c['handling'])} does not match assigned_at`);
    if (!field && (c['agent_id'] !== null || c['vehicle_id'] !== null)) err(`case ${num}: a remote case has an agent or vehicle`);
    if (c['arrived_at'] !== null && c['assigned_at'] === null) err(`case ${num}: arrived without being assigned`);
    if (Object.keys(c).some((k) => k === 'remote' || k === 'is_remote' || k === 'remote_flag')) err(`case ${num}: carries a remote flag`);
  }
  for (const e of entries.filter((x) => x.schema === 'Case')) {
    const day = e.path.replace(/^cases\//, '').replace(/\.json$/, '');
    const rows = (data.get(e.path) as Row[] | undefined) ?? [];
    for (const r of rows) if (!String(r['registered_at']).startsWith(day)) err(`${e.path}: case ${String(r['case_number'])} registered ${String(r['registered_at'])} is on another day`);
  }
  const replayDay = calibration.fixtures.replay.day.value;
  for (const r of rowsByKind.get('ReplayCase') ?? []) {
    if (r['handling'] !== 'field') err(`replay case ${String(r['case_number'])} is not a field case`);
    if (!String(r['registered_at']).startsWith(replayDay)) err(`replay case ${String(r['case_number'])} is not on ${replayDay}`);
    if (r['agent_id'] === null) err(`replay case ${String(r['case_number'])} has no agent (The customer's actual pick is needed for shadow mode)`);
  }

  // Engine outputs. The invariants JSON Schema cannot express come from scripts/contracts/invariants.ts, run on EVERY
  // engine output fixture (the same checker validate-contracts uses), never a copy of them. The rest is references.
  const engineData = (p: string): Row | undefined => data.get(p) as Row | undefined;
  const engineNames = new Set(listEngineSchemas());
  for (const e of entries) {
    if (!engineNames.has(e.schema)) continue;
    const parsed = data.get(e.path);
    if (parsed === undefined) continue;
    const docs = e.kind === 'array' ? (parsed as unknown[]) : [parsed];
    let shown = 0;
    docs.forEach((doc, i) => {
      const problems = checkEngineInvariants(e.schema, doc, { complete: true });
      for (const problem of problems) {
        if (shown < 5) err(`${e.path}${e.kind === 'array' ? ` record ${i}` : ''}: ${e.schema} invariant: ${problem}`);
        shown += 1;
      }
    });
    if (shown > 5) err(`${e.path}: ${shown} invariant problems in all (5 shown)`);
  }
  // Service-level readings stored in tables follow the simulator's rule (share = within_count / case_count) too.
  for (const kind of ['SimulationResult', 'DashboardRollup']) {
    const problems = readingInvariantProblems(rowsByKind.get(kind) ?? []);
    problems.slice(0, 5).forEach((problem) => err(`${kind} invariant: ${problem}`));
    if (problems.length > 5) err(`${kind}: ${problems.length} reading problems in all (5 shown)`);
  }
  const forecaster = engineData('engines/forecaster.output.json');
  if (forecaster !== undefined) {
    for (const v of forecaster['values'] as Row[]) {
      checkRef('forecaster value zone_id', 'Zone', v['zone_id']);
      checkRef('forecaster value sub_zone_id', 'SubZone', v['sub_zone_id']);
    }
  }
  const optimizer = engineData('engines/optimizer.output.json');
  if (optimizer !== undefined) {
    for (const a of optimizer['roster_assignments'] as Row[]) {
      checkRef('optimizer roster agent_id', 'Agent', a['agent_id']);
      checkRef('optimizer roster shift_pattern_id', 'ShiftPattern', a['shift_pattern_id']);
      checkRef('optimizer roster zone_id', 'Zone', a['zone_id']);
      checkRef('optimizer roster standby_point_id', 'StandbyPoint', a['standby_point_id']);
    }
    for (const v of optimizer['vehicle_assignments'] as Row[]) {
      checkRef('optimizer vehicle_id', 'Vehicle', v['vehicle_id']);
      checkRef('optimizer vehicle agent_id', 'Agent', v['agent_id']);
    }
    for (const g of optimizer['gap_cells'] as Row[]) checkRef('optimizer gap zone_id', 'Zone', g['zone_id']);
  }
  const simulator = engineData('engines/simulator.output.json');
  if (simulator !== undefined) {
    for (const z of (simulator['zones'] as Row[] | undefined) ?? []) checkRef('simulator zone_id', 'Zone', z['zone_id']);
  }
  const replayIds = new Set<string>((rowsByKind.get('ReplayCase') ?? []).map((r) => String(r['id'])));
  for (const out of rowsByKind.get('assignment.output') ?? []) {
    if (!replayIds.has(String(out['case_id']))) err(`assignment output for ${String(out['case_id'])}: not a replay case`);
    for (const r of out['ranking'] as Row[]) checkRef('assignment output ranking agent_id', 'Agent', r['agent_id']);
    for (const x of (out['excluded'] as Row[] | undefined) ?? []) checkRef('assignment output excluded agent_id', 'Agent', x['agent_id']);
  }
  const script = engineData('replay/script.json');
  if (script !== undefined) {
    if (script['total_cases'] !== replayIds.size) err(`replay/script.json total_cases ${String(script['total_cases'])} != ${replayIds.size} replay cases`);
    for (const ev of script['events'] as Row[]) {
      if (ev['kind'] === 'reassignment') {
        checkRef('replay script reassignment case_id', 'Case', ev['case_id']);
        checkRef('replay script reassignment from_agent_id', 'Agent', ev['from_agent_id']);
        checkRef('replay script reassignment agent_id', 'Agent', (ev['request'] as Row)['agent_id']);
      }
    }
  }

  // Sums the import job records must agree with.
  const issues = rowsByKind.get('DataQualityIssue') ?? [];
  for (const job of rowsByKind.get('ImportJob') ?? []) {
    const mine = issues.filter((i) => i['import_job_id'] === job['id']);
    if (mine.length !== job['issue_count']) err(`import job ${String(job['file_name'])}: issue_count ${String(job['issue_count'])} but ${mine.length} issues point at it`);
    const nErr = mine.filter((i) => i['severity'] === 'error').length;
    const nWarn = mine.filter((i) => i['severity'] === 'warning').length;
    if (job['error_count'] !== nErr) err(`import job ${String(job['file_name'])}: error_count ${String(job['error_count'])} but ${nErr} errors`);
    if (job['warning_count'] !== nWarn) err(`import job ${String(job['file_name'])}: warning_count ${String(job['warning_count'])} but ${nWarn} warnings`);
  }

  return {
    errors,
    counts: [...counts.entries()].map(([schema, v]) => ({ schema, files: v.files, records: v.records })).sort((a, b) => a.schema.localeCompare(b.schema)),
  };
}

export function main(): number {
  const started = process.hrtime.bigint();
  const report = validateFixtures();
  const totalRecords = report.counts.reduce((a, c) => a + c.records, 0);
  const totalFiles = report.counts.reduce((a, c) => a + c.files, 0);
  console.log('schema                     files   records');
  for (const c of report.counts) console.log(`${c.schema.padEnd(26)} ${String(c.files).padStart(5)} ${String(c.records).padStart(9)}`);
  console.log(`${'total'.padEnd(26)} ${String(totalFiles).padStart(5)} ${String(totalRecords).padStart(9)}`);
  if (report.errors.length > 0) {
    console.error(`\n${report.errors.length} problem${report.errors.length === 1 ? '' : 's'} found:`);
    for (const e of report.errors.slice(0, 80)) console.error(`  - ${e}`);
    if (report.errors.length > 80) console.error(`  ... and ${report.errors.length - 80} more`);
    return 1;
  }
  console.log(`\nAll fixtures valid (${Number((process.hrtime.bigint() - started) / 1_000_000n)} ms).`);
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main();
