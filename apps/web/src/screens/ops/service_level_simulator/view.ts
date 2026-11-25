// SPDX-License-Identifier: AGPL-3.0-only
// Service-Level Simulator view (server only)

import { addDays } from '@/lib/day';
import { date as formatDate } from '@opendispatch/ui/format';
import { listZones } from '@/lib/data/locations';
import type { RequestContext } from '@/lib/data/guard';
import { listRosters } from '@/lib/data/rosters';
import { listScenarios } from '@/lib/data/scenarios';
import { getSettingsSnapshot } from '@/lib/data/settings';
import { getSimulationHistoryRange, getSimulationRun, listSimulationResults, listSimulationRuns } from '@/lib/data/simulation';
import type { ClockStart, DataSource, Roster, Scenario, ServiceLevelReading, SimulationRun, Zone } from '@/lib/types';
import type { AssignmentPolicyOption } from './types';

const PAGE = 200;

export interface OptionItem {
  readonly value: string;
  readonly label: string;
}

export type RunRefKind = 'roster' | 'scenario' | 'all';

export interface RunRef {
  readonly kind: RunRefKind;
  readonly zoneCode?: string | undefined;
  readonly date?: string | undefined;
  readonly name?: string | undefined;
}

export interface ZoneRow {
  readonly zoneId: string;
  readonly zoneCode: string;
  readonly caseCount: number;
  readonly fieldCount: number;
  readonly fromAssignment: ServiceLevelReading;
  readonly fromRegistration: ServiceLevelReading;
  readonly medianSeconds: number | null;
  readonly p90Seconds: number | null;
}

export interface OverallReading {
  readonly fromAssignment: ServiceLevelReading;
  readonly fromRegistration: ServiceLevelReading;
  readonly medianSeconds: number | null;
  readonly p90Seconds: number | null;
  readonly fieldCaseCount: number;
}

export interface RunMeta {
  readonly ref: RunRef;
  readonly policy: AssignmentPolicyOption;
  readonly runDate: string;
  readonly thresholdSeconds: number;
  readonly createdAtIso: string;
  /** Simulator model and engine version, from the output. */
  readonly engine: { readonly model: string; readonly version: string } | null;
}

export interface HistoryRow {
  readonly id: string;
  readonly createdAtIso: string;
  readonly ref: RunRef;
  readonly policy: AssignmentPolicyOption;
  readonly runDate: string;
  readonly fromAssignmentShare: number | null;
  readonly fromAssignmentWithin: number;
  readonly fromRegistrationShare: number | null;
  readonly fieldCaseCount: number;
  readonly status: SimulationRun['status'];
  readonly selected: boolean;
}

export interface IntervalPoint {
  readonly label: string;
  readonly values: readonly [number, number];
}

export interface ServiceLevelSimulatorView {
  readonly sources: readonly DataSource[];
  readonly isEmpty: boolean;
  readonly clockStart: ClockStart;
  readonly targetShare: number | null;
  readonly rosterOptions: readonly OptionItem[];
  readonly dateOptions: readonly OptionItem[];
  readonly form: { readonly rosterId: string; readonly runDate: string; readonly policy: AssignmentPolicyOption };
  readonly selectedRunId: string | null;
  readonly runMeta: RunMeta | null;
  readonly illustrative: boolean;
  readonly overall: OverallReading | null;
  readonly zones: readonly ZoneRow[];
  readonly showTotal: boolean;
  readonly intervalZoneOptions: readonly OptionItem[];
  readonly intervalZone: string;
  readonly intervals: readonly IntervalPoint[];
  readonly history: readonly HistoryRow[];
  readonly historyCount: number;
}

export interface ServiceLevelSimulatorQuery {
  readonly run?: string | undefined;
  readonly ref?: string | undefined;
  readonly date?: string | undefined;
  readonly policy?: AssignmentPolicyOption | undefined;
  readonly izone?: string | undefined;
}

/** `extra.code` (RD-C), or the name if a zone
 * has none: the same rule every screen uses. */
function zoneCodeOf(zone: Zone | undefined): string {
  if (zone === undefined) return '—';
  const code = zone.extra?.['code'];
  return typeof code === 'string' && code !== '' ? code : zone.name_en;
}


function emptyView(sources: readonly DataSource[], clockStart: ClockStart, targetShare: number | null): ServiceLevelSimulatorView {
  return {
    sources,
    isEmpty: true,
    clockStart,
    targetShare,
    rosterOptions: [],
    dateOptions: [],
    form: { rosterId: '', runDate: '', policy: 'nearest' },
    selectedRunId: null,
    runMeta: null,
    illustrative: true,
    overall: null,
    zones: [],
    showTotal: false,
    intervalZoneOptions: [],
    intervalZone: '',
    intervals: [],
    history: [],
    historyCount: 0,
  };
}

export async function loadServiceLevelSimulatorView(ctx: RequestContext, query: ServiceLevelSimulatorQuery, locale: 'en' | 'ar'): Promise<ServiceLevelSimulatorView> {
  const sources: DataSource[] = ['SYNTHETIC'];
  const settings = await getSettingsSnapshot(ctx);
  const clockStart = settings.clock_start;
  const targetShare = settings.service_level_target_share ?? null;

  const runs = (await listSimulationRuns(ctx, { limit: PAGE })).items;
  if (runs.length === 0) return emptyView(sources, clockStart, targetShare);

  const rosterRows = (await listRosters(ctx, { limit: PAGE })).items;
  const scenarioRows = (await listScenarios(ctx, { limit: PAGE })).items;
  const zoneRows = (await listZones(ctx, { limit: PAGE })).items;
  const rosterById = new Map<string, Roster>(rosterRows.map((r) => [r.id, r] as const));
  const scenarioById = new Map<string, Scenario>(scenarioRows.map((s) => [s.id, s] as const));
  const zoneById = new Map<string, Zone>(zoneRows.map((z) => [z.id, z] as const));

  function refOf(r: SimulationRun): RunRef {
    if (r.roster_id !== null) {
      const roster = rosterById.get(r.roster_id);
      if (roster !== undefined) return { kind: 'roster', zoneCode: zoneCodeOf(zoneById.get(roster.zone_id)), date: roster.roster_date };
    }
    if (r.scenario_id !== null && r.scenario_id !== undefined) {
      const scenario = scenarioById.get(r.scenario_id);
      if (scenario !== undefined) return { kind: 'scenario', name: scenario.name };
    }
    return { kind: 'all' };
  }

  const rosterOptions: OptionItem[] = [...rosterRows]
    .sort((a, b) => b.roster_date.localeCompare(a.roster_date) || zoneCodeOf(zoneById.get(a.zone_id)).localeCompare(zoneCodeOf(zoneById.get(b.zone_id))))
    .map((r) => ({ value: r.id, label: `${zoneCodeOf(zoneById.get(r.zone_id))} — ${formatDate(r.roster_date, { locale })}` }));

  const range = await getSimulationHistoryRange(ctx);
  const dateOptions: OptionItem[] = [];
  if (range !== null) {
    for (let d = range.first; d <= range.last; d = addDays(d, 1)) dateOptions.push({ value: d, label: formatDate(d, { locale }) });
  }

  const requested = query.run !== undefined ? runs.find((r) => r.id === query.run) : undefined;
  // Default: newest run not made by a scenario
  const run = requested ?? runs.find((r) => r.scenario_id == null);

  const rosterIds = new Set(rosterOptions.map((o) => o.value));
  const dateValues = new Set(dateOptions.map((o) => o.value));
  const formRosterId = query.ref !== undefined && rosterIds.has(query.ref) ? query.ref : run?.roster_id != null && rosterIds.has(run.roster_id) ? run.roster_id : (rosterOptions[0]?.value ?? '');
  const formRunDate = query.date !== undefined && dateValues.has(query.date) ? query.date : run !== undefined && dateValues.has(run.run_date) ? run.run_date : (dateOptions[dateOptions.length - 1]?.value ?? '');
  const formPolicy: AssignmentPolicyOption = query.policy ?? run?.assignment_policy ?? 'nearest';

  const output = run === undefined ? null : (await getSimulationRun(ctx, run.id)).output;

  const zones: ZoneRow[] = (output?.zones ?? [])
    .map((z) => ({
      zoneId: z.zone_id,
      zoneCode: zoneCodeOf(zoneById.get(z.zone_id)),
      caseCount: z.service_level.case_count,
      fieldCount: z.service_level.field_case_count,
      fromAssignment: z.service_level.from_assignment,
      fromRegistration: z.service_level.from_registration,
      medianSeconds: z.service_level.assigned_to_arrived?.median_seconds ?? null,
      p90Seconds: z.service_level.assigned_to_arrived?.p90_seconds ?? null,
    }))
    .sort((a, b) => a.zoneCode.localeCompare(b.zoneCode));

  const overall: OverallReading | null =
    output === null
      ? null
      : {
          fromAssignment: output.overall.from_assignment,
          fromRegistration: output.overall.from_registration,
          medianSeconds: output.overall.assigned_to_arrived?.median_seconds ?? null,
          p90Seconds: output.overall.assigned_to_arrived?.p90_seconds ?? null,
          fieldCaseCount: output.overall.field_case_count,
        };

  const intervalZoneOptions: OptionItem[] = zones.map((z) => ({ value: z.zoneCode, label: z.zoneCode }));
  const intervalZone = query.izone !== undefined && intervalZoneOptions.some((o) => o.value === query.izone) ? query.izone : '';
  const zoneIdByCode = new Map(zones.map((z) => [z.zoneCode, z.zoneId] as const));
  const wantedZoneId = intervalZone === '' ? undefined : zoneIdByCode.get(intervalZone);
  const intervalItems = run === undefined ? [] : (await listSimulationResults(ctx, run.id, { limit: PAGE })).items;
  const intervalRows = intervalItems.filter((r) => r.interval_start !== null && (wantedZoneId === undefined || r.zone_id === wantedZoneId));
  const intervalByStart = new Map<string, { wa: number; wr: number; field: number }>();
  for (const row of intervalRows) {
    const start = row.interval_start as string;
    const bucket = intervalByStart.get(start) ?? { wa: 0, wr: 0, field: 0 };
    bucket.wa += row.from_assignment.within_count;
    bucket.wr += row.from_registration.within_count;
    bucket.field += row.field_case_count;
    intervalByStart.set(start, bucket);
  }
  const intervals: IntervalPoint[] = [...intervalByStart.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([start, bucket]) => ({
      label: start,
      values: [bucket.field === 0 ? 0 : Math.round((bucket.wa / bucket.field) * 100), bucket.field === 0 ? 0 : Math.round((bucket.wr / bucket.field) * 100)],
    }));

  const outputs = await Promise.all(runs.map(async (r) => (r.id === run?.id ? output : (await getSimulationRun(ctx, r.id)).output)));
  const history: HistoryRow[] = runs.map((r, index) => {
    const out = outputs[index];
    const rowOverall = out?.overall;
    return {
      id: r.id,
      createdAtIso: r.created_at,
      ref: refOf(r),
      policy: r.assignment_policy,
      runDate: r.run_date,
      fromAssignmentShare: rowOverall?.from_assignment.share ?? null,
      fromAssignmentWithin: rowOverall?.from_assignment.within_count ?? 0,
      fromRegistrationShare: rowOverall?.from_registration.share ?? null,
      fieldCaseCount: rowOverall?.field_case_count ?? 0,
      status: r.status,
      selected: r.id === run?.id,
    };
  });

  return {
    sources,
    isEmpty: false,
    clockStart,
    targetShare,
    rosterOptions,
    dateOptions,
    form: { rosterId: formRosterId, runDate: formRunDate, policy: formPolicy },
    selectedRunId: run?.id ?? null,
    runMeta: run === undefined ? null : { ref: refOf(run), policy: run.assignment_policy, runDate: run.run_date, thresholdSeconds: run.threshold_seconds, createdAtIso: run.created_at, engine: output === null ? null : { model: output.model_version, version: output.engine.version } },
    illustrative: output?.illustrative ?? run?.illustrative ?? true,
    overall,
    zones,
    showTotal: zones.length > 1,
    intervalZoneOptions,
    intervalZone,
    intervals,
    history,
    historyCount: history.length,
  };
}
