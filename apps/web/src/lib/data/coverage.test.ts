// SPDX-License-Identifier: AGPL-3.0-only
// The end-to-end test "every fixture loads through the data layer".
//
// Every schema named in fixtures/manifest.json has an entry in REGISTRY below: the public data function (or functions)
// that serve it, called as an Administrator, returning how many records they served. For an array fixture that count
// equals the manifest count (the functions are called unfiltered, or summed over every parent for the ones that are
// per parent). For an object fixture the function must return a non-empty object. A new fixture schema with no entry
// fails "has a registry entry for every manifest schema".
//
// The three engine outputs (forecaster, optimizer, simulator) are checked against their contract schema and against the
// fixture itself (counts, first and last values), never with `toBeTruthy()` (review finding M3).
//
// Strict: the files the data layer reads while those tests run are recorded (every file read under the fixtures folder from
// inside `recorded(...)`), and the last test asserts that they are exactly the files of the manifest: a manifest file no data
// function reads fails it, and so does a file read that the manifest does not list.

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ForecasterEngineOutput, OptimizerEngineOutput, SimulatorEngineOutput } from '@/lib/types';
import { listAuditEvents } from './audit';
import { listDashboardRollups, listProductivityRollups } from './dashboards';
import { listCases, listCaseTypes } from './cases';
import { controlReplay, getCaseRecommendation, getFallbackState, getReplayState, listAssignmentEvents, listAssignments, listLiveCases, listShadowComparisons } from './dispatch';
import { listDataQualityIssues, listImportJobs } from './imports';
import { fixtureSchemas, fixturesDir, readManifest } from './internal/fixtures';
import { listCities, listStandbyPoints, listSubZones, listZones } from './locations';
import { listApprovals, listNotificationLog, listNotificationRules } from './notifications';
import { listAllAgentSkills, listAgents, listVehicles } from './people';
import { getSettingsSnapshot, listSettings } from './settings';
import { listIntegrations } from './system';
import { listBreakRules, listHijriMonths, listHolidays, listPrayerTimes, listShiftPatterns } from './time';
import { listRoleMappings } from './identity';
import { listUsers } from './users';
import { getBundledOpenapi } from '../../../../../scripts/contracts/schemas';
import { ctxFor, expectValid, withTempDemoState } from './test-support';
// Data layer B (its modules are imported by the registry entries that need them).
import { getForecastTimeline, listForecastRuns, listForecastValues } from './forecast';
import { listLeaveRequests } from './leave';
import { listModelVersions } from './models';
import { getGapSurplus, listRosterAssignments, listRosterOverrides, listRosters } from './rosters';
import { listRuleVersions, listRules } from './rules';
import { listScenarios } from './scenarios';
import { getSimulationRun, listSimulationResults, listSimulationRuns } from './simulation';

withTempDemoState();

const ALL = { limit: 200 } as const;

// ---------------------------------------------------------------------------------------------
// Which fixture files does the data layer read?
// ---------------------------------------------------------------------------------------------

const filesRead = new Set<string>();
let recording = false;

beforeAll(() => {
  const real = fs.readFileSync.bind(fs) as (...args: unknown[]) => unknown;
  vi.spyOn(fs, 'readFileSync').mockImplementation(((file: unknown, ...rest: unknown[]) => {
    if (recording && typeof file === 'string') filesRead.add(path.resolve(file));
    return real(file, ...rest);
  }) as typeof fs.readFileSync);
});

afterAll(() => {
  vi.restoreAllMocks();
});

/**
 * Runs a data function call and records the fixture files it reads. Only calls made through here count as "served":
 * the checks a test makes against the fixture itself (`engineDocument`) read the file outside the recording, so they can
 * never make a file look served.
 */
function recorded<T>(run: () => T): T {
  recording = true;
  try {
    return run();
  } finally {
    recording = false;
  }
}

/** The fixture document as committed, read straight from disk (not through the loader, so the loader's cache stays empty). */
function engineDocument<T>(name: 'forecaster.output' | 'optimizer.output' | 'simulator.output'): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir(), 'engines', `${name}.json`), 'utf8')) as T;
}


/** The number of records a list served: its reported total, and never fewer than the items on the page. */
function served(list: { readonly items: readonly unknown[]; readonly page: { readonly total?: number | undefined } }): number {
  expect(list.items.length).toBeGreaterThan(0);
  return list.page.total ?? list.items.length;
}

/** Async form of pagesOf, for api-backed readers. */
async function pagesOfAsync<T>(read: (cursor: string | undefined) => Promise<{ readonly items: readonly T[]; readonly page: { readonly next_cursor: string | null } }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await read(cursor);
    out.push(...page.items);
    if (page.page.next_cursor === null) return out;
    cursor = page.page.next_cursor;
  }
}

/** Puts the replay at the end of the day so that every replay case has arrived (a Dispatch Supervisor may control it). */
async function replayAtEndOfDay(): Promise<void> {
  await controlReplay(ctxFor('dispatch_supervisor'), { action: 'seek', replay_at: '2026-09-14T00:00:00+03:00' });
}

type Entry = () => number | 'object' | Promise<number | 'object'>;

// api-backed: api-backed, shared, never reset.
const B2_SCHEMAS = ['City', 'Zone', 'SubZone', 'StandbyPoint', 'Agent', 'Vehicle', 'AgentSkill', 'ShiftPattern', 'BreakRule', 'Holiday', 'LeaveRequest', 'Roster', 'RosterAssignment', 'Case', 'CaseType', 'ImportJob', 'DataQualityIssue'];

const admin = () => ctxFor('administrator');

const REGISTRY: Readonly<Record<string, Entry>> = {
  // Admin, audit and settings
  AuditEvent: async () => served(await listAuditEvents(admin(), ALL)),
  // DataQualityIssue/ImportJob: api-backed.
  DataQualityIssue: async () => served(await listDataQualityIssues(admin(), ALL)),
  ImportJob: async () => served(await listImportJobs(admin(), ALL)),
  Integration: async () => served(await listIntegrations(admin(), ALL)),
  NotificationRule: async () => served((await listNotificationRules(admin(), ALL))),
  Notification: async () => served((await listNotificationLog(admin(), ALL))),
  RoleMapping: async () => served(await listRoleMappings(admin(), ALL)),
  Setting: async () => {
    expect((await getSettingsSnapshot(admin())).clock_start).toBe('assignment');
    return served(await listSettings(admin(), ALL));
  },
  User: async () => served(await listUsers(admin(), ALL)),
  Approval: async () => served(await listApprovals(admin(), ALL)),

  // Locations: api-backed, not a fixture read.
  City: async () => served(await listCities(admin(), ALL)),
  Zone: async () => served(await listZones(admin(), ALL)),
  SubZone: async () => served(await listSubZones(admin(), ALL)),
  StandbyPoint: async () => served(await listStandbyPoints(admin(), ALL)),

  // Roll-ups
  DashboardRollup: async () => {
    let total = 0;
    for (const level of ['zone', 'city', 'kingdom'] as const) total += served(await listDashboardRollups(admin(), { level, limit: 200 }));
    return total;
  },
  ProductivityRollup: async () => {
    let total = 0;
    for (const group_by of ['zone', 'agent'] as const) total += served(await listProductivityRollups(admin(), { group_by, limit: 200 }));
    return total;
  },

  // People: api-backed, not a fixture read.
  Agent: async () => served(await listAgents(admin(), ALL)),
  Vehicle: async () => served(await listVehicles(admin(), ALL)),
  AgentSkill: async () => {
    let total = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await listAllAgentSkills(admin(), { limit: 200, ...(cursor === undefined ? {} : { cursor }) });
      total += page.items.length;
      if (page.page.next_cursor === null) return total;
      cursor = page.page.next_cursor;
    }
  },
  // LeaveRequest: api-backed.
  LeaveRequest: async () => served(await listLeaveRequests(admin(), ALL)),

  // Cases and reference data: api-backed.
  Case: async () => served(await listCases(admin(), ALL)),
  CaseType: async () => served(await listCaseTypes(admin(), ALL)),
  // Shifts, breaks, holidays: api-backed.
  ShiftPattern: async () => served(await listShiftPatterns(admin(), ALL)),
  BreakRule: async () => served(await listBreakRules(admin(), ALL)),
  Holiday: async () => served(await listHolidays(admin(), ALL)),
  HijriMonth: async () => served(await listHijriMonths(admin(), ALL)),
  PrayerTime: async () => served(await listPrayerTimes(admin(), ALL)),

  // Rules, forecast, plans (data layer B)
  ClassificationRule: async () => served(await listRules(admin(), ALL)),
  RuleVersion: async () => {
    const rules = (await listRules(admin(), ALL)).items;
    const counts = await Promise.all(rules.map(async (r) => (await listRuleVersions(admin(), r.rule_code, ALL)).items.length));
    return counts.reduce((sum, n) => sum + n, 0);
  },
  ModelVersion: async () => served(await listModelVersions(admin(), ALL)),
  ForecastRun: async () => served(await listForecastRuns(admin(), ALL)),
  ForecastValue: async () => (await pagesOfAsync((cursor) => listForecastValues(admin(), { limit: 200, ...(cursor === undefined ? {} : { cursor }) }))).length,
  // Roster/RosterAssignment: api-backed.
  Roster: async () => served(await listRosters(admin(), ALL)),
  RosterAssignment: async () => {
    const allRosters: { readonly id: string }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await listRosters(admin(), { limit: 200, ...(cursor === undefined ? {} : { cursor }) });
      allRosters.push(...page.items);
      if (page.page.next_cursor === null) break;
      cursor = page.page.next_cursor;
    }
    const counts = await Promise.all(allRosters.map(async (r) => (await listRosterAssignments(admin(), r.id, { limit: 200 })).items.length));
    return counts.reduce((sum, n) => sum + n, 0);
  },
  Override: async () => {
    const allRosters: { readonly id: string }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await listRosters(admin(), { limit: 200, ...(cursor === undefined ? {} : { cursor }) });
      allRosters.push(...page.items);
      if (page.page.next_cursor === null) break;
      cursor = page.page.next_cursor;
    }
    const counts = await Promise.all(allRosters.map(async (r) => (await listRosterOverrides(admin(), r.id, ALL)).items.length));
    return counts.reduce((sum, n) => sum + n, 0);
  },

  Scenario: async () => served(await listScenarios(admin(), ALL)),
  SimulationRun: async () => served(await listSimulationRuns(admin(), ALL)),
  SimulationResult: async () => {
    const runs = (await listSimulationRuns(admin(), ALL)).items;
    const counts = await Promise.all(runs.map(async (run) => (await listSimulationResults(admin(), run.id, ALL)).items.length));
    return counts.reduce((sum, n) => sum + n, 0);
  },

  // Live dispatch
  Assignment: async () => served(await listAssignments(admin(), ALL)),
  AssignmentEvent: async () => {
    if ((await listAssignments(admin(), ALL)).items.length === 0) return 0;
    const assignments = await pagesOfAsync((cursor) => listAssignments(admin(), { limit: 200, ...(cursor === undefined ? {} : { cursor }) }));
    let total = 0;
    for (const a of assignments) total += (await pagesOfAsync((c) => listAssignmentEvents(admin(), a.id, { limit: 200, ...(c === undefined ? {} : { cursor: c }) }))).length;
    return total;
  },
  AssignmentComparison: async () => served(await listShadowComparisons(admin(), ALL)),
  ReplayCase: async () => {
    await replayAtEndOfDay();
    return served(await listLiveCases(admin(), ALL));
  },
  'assignment.output': async () => {
    await replayAtEndOfDay();
    const cases = await pagesOfAsync((cursor) => listLiveCases(admin(), { limit: 200, ...(cursor === undefined ? {} : { cursor }) }));
    for (const c of cases.slice(0, 5)) expectValid('AssignmentEngineOutput', await getCaseRecommendation(admin(), c.case_id));
    let matched = 0;
    for (const c of cases) if ((await getCaseRecommendation(admin(), c.case_id)).case_id === c.case_id) matched += 1;
    return matched;
  },
  ReplayScript: async () => {
    const replay = await getReplayState(admin());
    expect(replay.total_cases).toBeGreaterThan(0);
    expect((await getFallbackState(admin())).timeout_seconds).toBeGreaterThan(0);
    return 'object' as const;
  },
};

/** The three engine outputs. Each is served through the data layer and checked against the fixture in its own test below. */
const ENGINE_OUTPUTS = ['forecaster.output', 'optimizer.output', 'simulator.output'] as const;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

async function checkForecasterOutput(): Promise<void> {
  const doc = engineDocument<ForecasterEngineOutput>('forecaster.output');
  expectValid('ForecasterEngineOutput', doc);
  expect(doc.values).toHaveLength(doc.intervals_per_day * 16);
  // The run this output belongs to: same model, same engine, produced when the run finished.
  const run = (await recorded(() => listForecastRuns(admin(), ALL))).items.find((r) => r.model_version === doc.model_version && r.engine_version === doc.engine.version && r.finished_at === doc.generated_at);
  expect(run, 'a forecast run for the committed forecaster output').toBeDefined();
  const zoneId = doc.values[0]!.zone_id;
  const timeline = await recorded(() => getForecastTimeline(admin(), { zone_id: zoneId, date: doc.horizon.start_date, run_id: run!.id }));
  expectValid('ForecastTimeline', timeline);
  expect(timeline.forecast_run_id).toBe(run!.id);
  expect(timeline.intervals).toHaveLength(doc.intervals_per_day);
  // Each interval of the timeline is the sum of the fixture's sub-zone values of that interval (first, last and all between).
  for (const interval of timeline.intervals) {
    const rows = doc.values.filter((value) => value.zone_id === zoneId && value.interval_index === interval.interval_index);
    expect(rows.length, `sub-zone rows of interval ${String(interval.interval_index)}`).toBeGreaterThan(0);
    expect(interval.interval_start).toBe(rows[0]!.interval_start);
    expect(interval.expected).toBeCloseTo(round3(rows.reduce((sum, row) => sum + row.expected, 0)), 3);
    expect(interval.low).toBeCloseTo(round3(rows.reduce((sum, row) => sum + row.low, 0)), 3);
    expect(interval.high).toBeCloseTo(round3(rows.reduce((sum, row) => sum + row.high, 0)), 3);
  }
  const first = timeline.intervals[0]!;
  const last = timeline.intervals[timeline.intervals.length - 1]!;
  expect([first.interval_index, last.interval_index]).toEqual([0, doc.intervals_per_day - 1]);
  expect(first.interval_start).toBe(doc.values.find((v) => v.zone_id === zoneId && v.interval_index === 0)!.interval_start);
  expect(last.interval_start).toBe(doc.values.find((v) => v.zone_id === zoneId && v.interval_index === doc.intervals_per_day - 1)!.interval_start);
}

async function checkOptimizerOutput(): Promise<void> {
  const doc = engineDocument<OptimizerEngineOutput>('optimizer.output');
  expectValid('OptimizerEngineOutput', doc);
  // The roster module reads the optimizer's staffing as its baseline: on the day of the output the gap view IS the output's cells.
  // required: rescaled to the set capacity
  const view = await recorded(() => getGapSurplus(admin(), { date: doc.roster_date }));
  const capacity = new Map((view.required_staffing?.zones ?? []).map((z) => [z.zone_id, z.cases_per_agent_per_interval] as const));
  const required = (cell: { zone_id: string; required: number }) => Math.round((cell.required * (0.25 * 0.5)) / 0.55 / (capacity.get(cell.zone_id) ?? Number.NaN));
  expectValid('GapSurplusView', view);
  expect(view.roster_date).toBe(doc.roster_date);
  // Zone is api-backed: other live files may add one for this date.
  expect(view.cells.length).toBeGreaterThanOrEqual(doc.gap_cells.length);
  const served = new Map(view.cells.map((cell) => [`${cell.zone_id}|${String(cell.interval_index)}`, cell] as const));
  expect(served.size).toBeGreaterThanOrEqual(doc.gap_cells.length);
  for (const cell of doc.gap_cells) {
    const got = served.get(`${cell.zone_id}|${String(cell.interval_index)}`);
    expect(got, `cell ${cell.zone_id} ${String(cell.interval_index)}`).toBeDefined();
    const need = required(cell);
    const delta = cell.planned - need;
    expect(got).toMatchObject({ interval_start: cell.interval_start, required: need, planned: cell.planned, delta, kind: delta < 0 ? 'gap' : delta > 0 ? 'surplus' : 'balanced' });
  }
  const first = doc.gap_cells[0]!;
  const last = doc.gap_cells[doc.gap_cells.length - 1]!;
  expect(served.get(`${first.zone_id}|${String(first.interval_index)}`)).toMatchObject({ interval_index: 0, required: required(first), planned: first.planned });
  expect(served.get(`${last.zone_id}|${String(last.interval_index)}`)).toMatchObject({ interval_index: 95, required: required(last), planned: last.planned });
}

async function checkSimulatorOutput(): Promise<void> {
  const doc = engineDocument<SimulatorEngineOutput>('simulator.output');
  expectValid('SimulatorEngineOutput', doc);
  // The run of the same day and policy: its stored results are what getSimulationRun turns back into an engine output.
  const day = doc.roster_ref.replace(/^actual-/, '');
  const run = (await recorded(() => listSimulationRuns(admin(), ALL))).items.find((r) => r.assignment_policy === doc.assignment_policy && r.run_date === day);
  expect(run, 'a simulation run for the committed simulator output').toBeDefined();
  const out = (await recorded(() => getSimulationRun(admin(), run!.id))).output;
  expect(out).not.toBeNull();
  expectValid('SimulatorEngineOutput', out);
  const served = out as SimulatorEngineOutput;
  expect(served.engine).toEqual(doc.engine);
  expect(served).toMatchObject({ assignment_policy: doc.assignment_policy, primary_clock_start: doc.primary_clock_start, threshold_seconds: doc.threshold_seconds, unserved_cases: doc.unserved_cases, roster_ref: doc.roster_ref });
  expect(served.overall).toMatchObject({ case_count: doc.overall.case_count, field_case_count: doc.overall.field_case_count });
  expect(served.overall.from_assignment.within_count).toBe(doc.overall.from_assignment.within_count);
  expect(served.overall.from_registration.within_count).toBe(doc.overall.from_registration.within_count);
  const docZones = doc.zones ?? [];
  const servedZones = served.zones ?? [];
  expect(docZones.length).toBeGreaterThan(0);
  expect(servedZones).toHaveLength(docZones.length);
  const byZone = new Map(servedZones.map((zone) => [zone.zone_id, zone.service_level] as const));
  for (const zone of docZones) {
    const got = byZone.get(zone.zone_id);
    expect(got, `zone ${zone.zone_id}`).toBeDefined();
    expect(got).toMatchObject({ case_count: zone.service_level.case_count, field_case_count: zone.service_level.field_case_count });
    expect(got!.from_assignment.within_count).toBe(zone.service_level.from_assignment.within_count);
    expect(got!.from_assignment.share ?? 0).toBeCloseTo(zone.service_level.from_assignment.share ?? 0, 5);
    expect(got!.from_registration.share ?? 0).toBeCloseTo(zone.service_level.from_registration.share ?? 0, 5);
  }
  // first and last zone of the fixture
  for (const zone of [docZones[0]!, docZones[docZones.length - 1]!]) expect(byZone.get(zone.zone_id)?.case_count).toBe(zone.service_level.case_count);
}

const ENGINE_CHECKS: Readonly<Record<(typeof ENGINE_OUTPUTS)[number], () => void | Promise<void>>> = {
  'forecaster.output': checkForecasterOutput,
  'optimizer.output': checkOptimizerOutput,
  'simulator.output': checkSimulatorOutput,
};

// ---------------------------------------------------------------------------------------------
// Every operation of the contract has a data function
// ---------------------------------------------------------------------------------------------

describe('every contract operation has a data function', () => {
  const contractOperations = (): string[] => {
    const ids: string[] = [];
    for (const item of Object.values(getBundledOpenapi().paths as Record<string, Record<string, unknown>>)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const id = (item[method] as { operationId?: unknown } | undefined)?.operationId;
        if (typeof id === 'string') ids.push(id);
      }
    }
    return ids;
  };

  /** The 14 operations added to the first 243 (contracts/README.md, decisions 20 to 27), and `getUpdateRecovery`, added for the Updates screen (a restore request can be read again after a reload), `getEngineStatuses`, added for the Engines card on System Health, and the three Updates PATCH writes, the demo sign-in pair, the forecast explanation and micro-cell reads, the working assumptions read, and the forecast backtest read and run the forecast-against-actual read, and the forecast model settings read and write, and the rolling forecast accuracy read, and the long-horizon leave outlook read, and the experiment list and the retrain. */
  const A2_OPERATIONS = [
    'listUserDisplayNames',
    'grantSupportAccess',
    'endSupportAccess',
    'cancelScheduledUpdate',
    'requestIdentityProviderChange',
    'setMaintenanceMode',
    'addSkill',
    'getQuietHours',
    'updateQuietHours',
    'getRateLimits',
    'updateRateLimits',
    'retryWebhookDelivery',
    'importLocations',
    'importAgents',
    'getUpdateRecovery',
    'getEngineStatuses',
    'patchUpdateConnection',
    'patchUpdateChangeWindows',
    'patchUpdateChangePolicy',
    'getDemoOptions',
    'demoSignIn',
    'getForecastExplanation',
    'getForecastLocations',
    'getWorkingAssumptions',
    'getForecastBacktest',
    'runForecastBacktest',
    'getForecastAccuracy',
    'listAllAgentSkills',
    'getProductivityDurations',
    'getForecastModelSettings',
    'updateForecastModelSettings',
    'getRollingForecastAccuracy',
    'getLeaveOutlook',
    'getOverCapacity',
    'getOverrideRate',
    'getUtilization',
    'rollbackImport',
    'listVehicleMaintenance',
    'createVehicleMaintenance',
    'deleteVehicleMaintenance',
    'rotateApiClient',
    'updateSkill',
    'removeSkill',
    'listCalendarEvents',
    'createCalendarEvent',
    'updateCalendarEvent',
    'deleteCalendarEvent',
    'updatePaydayDay',
    'updateOptimizerModel',
    'updateBreakPrayerPolicy',
    'getScheduleAdherence',
    'listForecastExperiments',
    'retrainForecastModel',
    'getRemoteRoster',
    'getRemoteCapacity',
    'getRemoteProductivity',
    'updateRemoteHandling',
    'listUnmetDemand',
    'listWaitingSpots',
    'getRosterWeek',
    'buildRosterWeek',
    'submitRosterWeek',
    'publishRosterWeek',
    'getNetAvailability',
    'getAssistantStatus',
    'draftRuleWithAssistant',
    'explainWithAssistant',
    'askAssistant',
    'summariseShiftHandover',
    'summariseMyAlerts',
    'getAssistantOverview',
    'testAssistantConnection',
    'suggestImportMappingWithAssistant',
    'explainImportIssuesWithAssistant',
    'readEventNoticeWithAssistant',
    'draftScenarioWithAssistant',
    'getCaseSuggestion',
    'suggestCaseClassification',
    'reviewCaseSuggestion',
    'getClassifierReview',
    'runClassifierReview',
    'createImportMapping',
    'createImportUpload',
    'getImportUpload',
    'cancelImportUpload',
    'putImportUploadChunk',
    'completeImportUpload',
    'startImportStep',
  ];

  it('counts 331 operations: the first 243 and the 88 added since, each once', () => {
    const ids = contractOperations();
    expect(ids).toHaveLength(331);
    expect(new Set(ids).size).toBe(331);
    for (const id of A2_OPERATIONS) expect(ids, id).toContain(id);
    expect(ids.filter((id) => !A2_OPERATIONS.includes(id))).toHaveLength(243);
  });

  it('finds an exported function of that name in the public data modules, for every one of the 262', () => {
    const modules = import.meta.glob(['./*.ts', '!./*.test.ts', '!./test-support.ts'], { eager: true }) as Record<string, Record<string, unknown>>;
    const exported = new Set(Object.values(modules).flatMap((mod) => Object.entries(mod).filter(([, value]) => typeof value === 'function').map(([name]) => name)));
    expect(contractOperations().filter((id) => !exported.has(id))).toEqual([]);
  });
});

describe('every fixture loads through the data layer', () => {
  const manifest = readManifest();
  const schemas = fixtureSchemas();

  it('finds the fixtures', () => {
    expect(schemas.length).toBeGreaterThan(40);
    expect(manifest.length).toBeGreaterThan(50);
  });

  it('has a registry entry for every manifest schema', () => {
    const missing = schemas.filter((schema) => REGISTRY[schema] === undefined && !(ENGINE_OUTPUTS as readonly string[]).includes(schema));
    expect(missing).toEqual([]);
    const stale = Object.keys(REGISTRY).filter((schema) => !schemas.includes(schema));
    expect(stale).toEqual([]);
  });

  for (const schema of schemas) {
    const entries = manifest.filter((e) => e.schema === schema);
    const expected = entries.reduce((sum, e) => sum + e.count, 0);
    const kind = entries[0]?.kind;
    if ((ENGINE_OUTPUTS as readonly string[]).includes(schema)) {
      it(`serves ${schema} (object): valid against its contract schema and equal to the fixture`, async () => {
        await ENGINE_CHECKS[schema as (typeof ENGINE_OUTPUTS)[number]]();
      });
      continue;
    }
    it(`serves ${schema} (${kind === 'object' ? 'object' : `${expected} records`})`, async () => {
      const entry = REGISTRY[schema];
      expect(entry, `no registry entry for ${schema}`).toBeDefined();
      const result = await recorded(entry as Entry);
      if (kind === 'object') expect(result).toBe('object');
      // api-backed: shared, so never fewer than the fixture.
      else if (B2_SCHEMAS.includes(schema)) expect(result).toBeGreaterThanOrEqual(expected);
      else {
        expect(result).toBeGreaterThan(0);
        expect(result).toBe(expected);
      }
    });
  }

  // Keep this test last: it reads what every test above recorded.
  it('read exactly the files of the manifest through the data layer: none missing, none extra', () => {
    const dir = fixturesDir();
    // the Go cut-over (settings, cases,
    // forecast core, dispatch, replay, dashboards):
    // Go reads these fixtures now, not the TS layer.
    const B2_UNREAD = [
      'admin/audit_events.json', // api-backed: the audit log is Go's, in Postgres
      'admin/data_quality_issues.json',
      'admin/import_jobs.json',
      'admin/integrations.json',
      'admin/notification_rules.json',
      'admin/notifications.json',
      'admin/role_mappings.json',
      'admin/settings.json',
      'cases/2026-09-06.json',
      'cases/2026-09-07.json',
      'cases/2026-09-08.json',
      'cases/2026-09-09.json',
      'cases/2026-09-10.json',
      'cases/2026-09-11.json',
      'cases/2026-09-12.json',
      'engines/forecaster.output.json',
      'engines/optimizer.output.json',
      'engines/simulator.output.json',
      'live/assignment_comparisons.json',
      'live/assignment_events.json',
      'live/assignments.json',
      'locations/cities.json',
      'locations/standby_points.json',
      'locations/sub_zones.json',
      'people/leave_requests.json',
      'people/agent_skills.json',
      'people/agents.json',
      'people/vehicles.json',
      'plans/forecast_runs.json',
      'plans/forecast_values/DM-C.json',
      'plans/forecast_values/JD-N.json',
      'plans/forecast_values/JD-S.json',
      'plans/forecast_values/RD-C.json',
      'plans/forecast_values/RD-E.json',
      'plans/forecast_values/RD-N.json',
      'plans/forecast_values/RD-S.json',
      'plans/forecast_values/RD-W.json',
      'plans/overrides.json',
      'plans/roster_assignments/2026-09-13.json',
      'plans/roster_assignments/2026-09-14.json',
      'plans/roster_assignments/2026-09-15.json',
      'plans/roster_assignments/2026-09-16.json',
      'plans/roster_assignments/2026-09-17.json',
      'plans/roster_assignments/2026-09-18.json',
      'plans/roster_assignments/2026-09-19.json',
      'plans/rosters.json',
      'plans/scenarios.json',
      'plans/simulation_results.json',
      'plans/simulation_runs.json',
      'reference/approvals.json',
      'reference/break_rules.json',
      'reference/case_types.json',
      'reference/classification_rules.json',
      'reference/hijri_months.json',
      'reference/holidays.json',
      'reference/model_versions.json',
      'reference/prayer_times.json',
      'reference/rule_versions.json',
      'reference/shift_patterns.json',
      'replay/assignment_outputs.json',
      'replay/cases.json',
      'replay/script.json',
      'rollups/dashboard_rollups.json',
      'rollups/productivity_rollups.json',
    ];
    const listed = manifest.map((entry) => path.resolve(dir, entry.path)).sort();
    const read = [...filesRead].filter((file) => file.startsWith(`${dir}${path.sep}`) && path.basename(file) !== 'manifest.json').sort();
    expect(listed.filter((file) => !read.includes(file)).map((file) => path.relative(dir, file)), 'manifest files no data function read').toEqual(B2_UNREAD);
    expect(read.filter((file) => !listed.includes(file)).map((file) => path.relative(dir, file)), 'files read that the manifest does not list').toEqual([]);
    expect(read).toHaveLength(manifest.length - B2_UNREAD.length);
  });
});
