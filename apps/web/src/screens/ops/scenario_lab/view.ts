// SPDX-License-Identifier: AGPL-3.0-only
// Scenario Lab view model (server only)

import { addDays } from '@/lib/day';
import { date, formatPercent, time } from '@opendispatch/ui/format';
import { getDemoToday } from '@/lib/data/settings';
import type { RequestContext } from '@/lib/data/guard';
import { listCities, listZones } from '@/lib/data/locations';
import { getGapSurplus } from '@/lib/data/rosters';
import { getSimulationRun, listSimulationRuns } from '@/lib/data/simulation';
import { listScenarios } from '@/lib/data/scenarios';
import { listShiftPatterns } from '@/lib/data/time';
import type { DataSource, Scenario, ShiftPattern, Zone } from '@/lib/types';
import type { PickerZone } from '@/components/opendispatch/patterns/ZonePicker';
import { changeParts, remoteReading, remoteTotal, unsupportedParts, type ChangePart } from './changes';
import type { ScenarioFormValues, TemplateKey } from './types';

/** Not exported from lib/types (a nested schema). */
type GapCell = Awaited<ReturnType<typeof getGapSurplus>>['cells'][number];

const PAGE = 200;
const BASE_DAYS = 7;
const HEAT_BUCKETS = 12;
const INTERVALS_PER_DAY = 96;
const INTERVALS_PER_BUCKET = INTERVALS_PER_DAY / HEAT_BUCKETS;
/** The mockup's own order. */
const PATTERN_ORDER = ['DAY-A', 'DAY-B', 'EVENING', 'NIGHT'];

export interface OptionItem {
  readonly value: string;
  readonly label: string;
}

export interface PatternOption {
  readonly id: string;
  /** The pattern's own code: data, translate="no". */
  readonly code: string;
}

export interface SavedRowView {
  readonly id: string;
  readonly name: string;
  readonly dateLabel: string;
  readonly zoneCodes: readonly string[];
  readonly changes: readonly ChangePart[];
  readonly status: Scenario['status'];
  readonly lastRunLabel: string | null;
  readonly isOpen: boolean;
}

interface KindCounts {
  readonly gap: number;
  readonly balanced: number;
  readonly surplus: number;
}

export interface ZoneCompareRow {
  readonly zoneId: string;
  readonly code: string;
  readonly before: KindCounts;
  readonly after: KindCounts;
  readonly gapDelta: number;
}

export interface HeatView {
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  readonly values: readonly (number | null)[][];
}

export interface ReadingView {
  readonly fromAssignmentPct: string;
  readonly fromRegistrationPct: string;
  readonly primaryIsAssignment: boolean;
}

export interface ComparisonView {
  readonly zoneRows: readonly ZoneCompareRow[];
  readonly heat: HeatView;
  readonly reading: ReadingView | undefined;
  /** Stale: older than the scenario or its run. */
  readonly stale: boolean;
  readonly totalGaps: number;
  readonly totalSurplus: number;
  /** Simulator model and engine, from the run. */
  readonly engine: { readonly model: string; readonly version: string } | null;
  readonly unsupported: ReturnType<typeof unsupportedParts>;
}

export interface ScenarioLabView {
  readonly isEmpty: boolean;
  readonly sources: readonly DataSource[];
  readonly zoneOptions: readonly PickerZone[];
  readonly patternOptions: readonly PatternOption[];
  readonly dateOptions: readonly OptionItem[];
  readonly templates: Readonly<Record<TemplateKey, ScenarioFormValues>>;
  readonly savedRows: readonly SavedRowView[];
  readonly total: number;
  readonly openId: string | null;
  readonly openIsNew: boolean;
  readonly openStatus: Scenario['status'];
  readonly openLastRunLabel: string | null;
  readonly openUpdatedLabel: string | null;
  readonly form: ScenarioFormValues;
  readonly comparison: ComparisonView | undefined;
  readonly unknownId: boolean;
}

export interface ScenarioLabQuery {
  readonly scenario?: string | undefined;
  readonly tpl?: TemplateKey | undefined;
}

function zoneCode(zone: Zone): string {
  return typeof zone.extra?.['code'] === 'string' ? zone.extra['code'] : zone.id;
}

function localizedName(record: { readonly name_en: string; readonly name_ar?: string | null | undefined }, locale: 'en' | 'ar'): string {
  return locale === 'ar' && record.name_ar !== null && record.name_ar !== undefined && record.name_ar.trim() !== '' ? record.name_ar : record.name_en;
}


/** Field and vehicles: the same delta per zone. */
function representativeDelta(scenario: Scenario, key: 'field_agents' | 'remote_agents' | 'vehicles'): number {
  const first = scenario.adjustments.headcount_delta?.[0];
  return first?.[key] ?? 0;
}

/** The pool change, from either reading. */
function remoteOf(scenario: Scenario): number {
  return remoteTotal(remoteReading(scenario.zone_ids, scenario.adjustments.headcount_delta ?? []), scenario.zone_ids);
}

function formOf(scenario: Scenario): ScenarioFormValues {
  const reading = remoteReading(scenario.zone_ids, scenario.adjustments.headcount_delta ?? []);
  return {
    name: scenario.name,
    baseDate: scenario.base_date,
    zoneIds: scenario.zone_ids,
    field: representativeDelta(scenario, 'field_agents'),
    remote: reading.company,
    remoteMode: reading.mode,
    remoteByZone: reading.byZone,
    veh: representativeDelta(scenario, 'vehicles'),
    sharePercent: scenario.adjustments.remote_share == null ? null : Math.round(scenario.adjustments.remote_share * 100),
    patternIds: scenario.adjustments.shift_pattern_ids ?? [],
  };
}

function changesOf(scenario: Scenario, patternCodeById: Map<string, string>): ChangePart[] {
  return changeParts({
    field: representativeDelta(scenario, 'field_agents'),
    remote: remoteOf(scenario),
    veh: representativeDelta(scenario, 'vehicles'),
    patternCodes: (scenario.adjustments.shift_pattern_ids ?? []).map((id) => patternCodeById.get(id)).filter((c): c is string => c !== undefined),
    sharePercent: scenario.adjustments.remote_share == null ? null : Math.round(scenario.adjustments.remote_share * 100),
  });
}

function countKinds(cells: readonly GapCell[]): KindCounts {
  let gap = 0;
  let balanced = 0;
  let surplus = 0;
  for (const cell of cells) {
    if (cell.kind === 'gap') gap += 1;
    else if (cell.kind === 'surplus') surplus += 1;
    else balanced += 1;
  }
  return { gap, balanced, surplus };
}

/** 96 quarter-hours into 12 two-hour means. */
function bucketize(cells: readonly GapCell[]): (number | null)[] {
  const byIndex = new Map(cells.map((c) => [c.interval_index, c.delta] as const));
  const out: (number | null)[] = [];
  for (let b = 0; b < HEAT_BUCKETS; b += 1) {
    let sum = 0;
    let seen = 0;
    for (let k = 0; k < INTERVALS_PER_BUCKET; k += 1) {
      const delta = byIndex.get(b * INTERVALS_PER_BUCKET + k);
      if (delta === undefined) continue;
      sum += delta;
      seen += 1;
    }
    // "+ 0" turns -0 into 0 for JSON
    out.push(seen === 0 ? null : Math.round(sum / seen) + 0);
  }
  return out;
}

function templateOf(zoneOptions: readonly PickerZone[], patternIdByCode: Map<string, string>, count: 1 | 2 | 5, sharePercent: number | null, field: number, veh: number, patternCodes: readonly string[], baseDate: string): ScenarioFormValues {
  return {
    name: '',
    baseDate,
    zoneIds: zoneOptions.slice(0, count).map((z) => z.id),
    field,
    remote: 0,
    remoteMode: 'company',
    remoteByZone: {},
    veh,
    sharePercent,
    patternIds: patternCodes.map((code) => patternIdByCode.get(code)).filter((id): id is string => id !== undefined),
  };
}

function emptyView(sources: readonly DataSource[]): ScenarioLabView {
  return {
    isEmpty: true,
    sources,
    zoneOptions: [],
    patternOptions: [],
    dateOptions: [],
    templates: {
      people: { name: '', baseDate: '', zoneIds: [], field: 0, remote: 0, remoteMode: 'company', remoteByZone: {}, veh: 0, sharePercent: null, patternIds: [] },
      ramadan: { name: '', baseDate: '', zoneIds: [], field: 0, remote: 0, remoteMode: 'company', remoteByZone: {}, veh: 0, sharePercent: null, patternIds: [] },
      remote: { name: '', baseDate: '', zoneIds: [], field: 0, remote: 0, remoteMode: 'company', remoteByZone: {}, veh: 0, sharePercent: null, patternIds: [] },
    },
    savedRows: [],
    total: 0,
    openId: null,
    openIsNew: true,
    openStatus: 'draft',
    openLastRunLabel: null,
    openUpdatedLabel: null,
    form: { name: '', baseDate: '', zoneIds: [], field: 0, remote: 0, remoteMode: 'company', remoteByZone: {}, veh: 0, sharePercent: null, patternIds: [] },
    comparison: undefined,
    unknownId: false,
  };
}

async function comparisonOf(ctx: RequestContext, scenario: Scenario, zoneCodeById: Map<string, string>, locale: 'en' | 'ar'): Promise<ComparisonView> {
  const [after, beforeAll] = await Promise.all([getGapSurplus(ctx, { scenario_id: scenario.id }), getGapSurplus(ctx, { date: scenario.base_date })]);
  const zoneIdSet = new Set(scenario.zone_ids);
  const before = beforeAll.cells.filter((c) => zoneIdSet.has(c.zone_id));

  const groupByZone = (cells: readonly GapCell[]): Map<string, GapCell[]> => {
    const out = new Map<string, GapCell[]>();
    for (const cell of cells) {
      const list = out.get(cell.zone_id);
      if (list === undefined) out.set(cell.zone_id, [cell]);
      else list.push(cell);
    }
    return out;
  };
  const beforeByZone = groupByZone(before);
  const afterByZone = groupByZone(after.cells);

  const rows: string[] = [];
  const values: (number | null)[][] = [];
  const zoneRows: ZoneCompareRow[] = scenario.zone_ids.map((zoneId) => {
    const code = zoneCodeById.get(zoneId) ?? zoneId;
    const beforeCells = beforeByZone.get(zoneId) ?? [];
    const afterCells = afterByZone.get(zoneId) ?? [];
    const beforeCounts = countKinds(beforeCells);
    const afterCounts = countKinds(afterCells);
    rows.push(code);
    values.push(bucketize(beforeCells));
    rows.push(code);
    values.push(bucketize(afterCells));
    return { zoneId, code, before: beforeCounts, after: afterCounts, gapDelta: afterCounts.gap - beforeCounts.gap };
  });

  const columns = Array.from({ length: HEAT_BUCKETS }, (_, i) => time(i * 120));

  let reading: ReadingView | undefined;
  let engine: ComparisonView['engine'] = null;
  if (scenario.status === 'completed') {
    const runs = (await listSimulationRuns(ctx, { limit: PAGE })).items.filter((r) => r.scenario_id === scenario.id);
    const latest = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const detail = latest === undefined ? undefined : await getSimulationRun(ctx, latest.id);
    const output = detail?.output ?? null;
    if (output !== null) {
      reading = {
        fromAssignmentPct: formatPercent(output.overall.from_assignment.share, locale),
        fromRegistrationPct: formatPercent(output.overall.from_registration.share, locale),
        primaryIsAssignment: output.primary_clock_start === 'assignment',
      };
      engine = { model: output.model_version, version: output.engine.version };
    }
  }

  const stale = scenario.last_run_at != null && scenario.updated_at.localeCompare(scenario.last_run_at) > 0;
  const totalGaps = zoneRows.reduce((sum, r) => sum + r.after.gap, 0);
  const totalSurplus = zoneRows.reduce((sum, r) => sum + r.after.surplus, 0);

  const unsupported = reading === undefined ? [] : unsupportedParts({ remote: remoteOf(scenario) });

  return { zoneRows, heat: { rows, columns, values }, reading, stale, totalGaps, totalSurplus, engine, unsupported };
}

export async function loadScenarioLabView(ctx: RequestContext, query: ScenarioLabQuery, locale: 'en' | 'ar'): Promise<ScenarioLabView> {
  const list = await listScenarios(ctx, { limit: PAGE });
  const requestedId = query.scenario;
  const isEmpty = list.items.length === 0 && requestedId === undefined;
  if (isEmpty) return emptyView(['SYNTHETIC']);

  const zones = (await listZones(ctx, { limit: PAGE })).items;
  const cities = (await listCities(ctx, { limit: PAGE })).items;
  const cityNameById = new Map(cities.map((c) => [c.id, localizedName(c, locale)] as const));
  const zoneOptions: PickerZone[] = zones.map((z) => ({ id: z.id, code: zoneCode(z), name: localizedName(z, locale), cityId: z.city_id, cityName: cityNameById.get(z.city_id) ?? '' }));
  const zoneCodeById = new Map(zones.map((z) => [z.id, zoneCode(z)] as const));

  const patterns = (await listShiftPatterns(ctx, { limit: PAGE })).items.filter((p: ShiftPattern) => p.kind === 'field' && p.status === 'active');
  const sortedPatterns = [...patterns].sort((a, b) => PATTERN_ORDER.indexOf(a.code) - PATTERN_ORDER.indexOf(b.code));
  const patternOptions: PatternOption[] = sortedPatterns.map((p) => ({ id: p.id, code: p.code }));
  const patternCodeById = new Map(patterns.map((p) => [p.id, p.code] as const));
  const patternIdByCode = new Map(patterns.map((p) => [p.code, p.id] as const));

  const baseDate = addDays(await getDemoToday(ctx), 1);
  const templates: Record<TemplateKey, ScenarioFormValues> = {
    people: templateOf(zoneOptions, patternIdByCode, 1, null, 4, 2, ['DAY-A', 'DAY-B', 'NIGHT'], baseDate),
    ramadan: templateOf(zoneOptions, patternIdByCode, 2, null, 0, 0, ['DAY-A', 'DAY-B', 'EVENING', 'NIGHT'], baseDate),
    remote: templateOf(zoneOptions, patternIdByCode, 5, 35, 0, 0, ['DAY-A', 'DAY-B', 'NIGHT'], baseDate),
  };
  const blank: ScenarioFormValues = templateOf(zoneOptions, patternIdByCode, 1, null, 0, 0, ['DAY-A', 'DAY-B', 'NIGHT'], baseDate);

  const isNewRequest = requestedId === 'new';
  const found = isNewRequest ? undefined : list.items.find((s) => s.id === requestedId);
  const unknownId = !isNewRequest && requestedId !== undefined && found === undefined;
  const fallback = list.items[0];
  const open = found ?? (isNewRequest ? undefined : fallback);
  const openIsNew = open === undefined;

  const savedRows: SavedRowView[] = list.items.map((s) => ({
    id: s.id,
    name: s.name,
    dateLabel: date(s.base_date, { locale }),
    zoneCodes: s.zone_ids.map((id) => zoneCodeById.get(id) ?? id),
    changes: changesOf(s, patternCodeById),
    status: s.status,
    lastRunLabel: s.last_run_at == null ? null : date(s.last_run_at, { locale }),
    isOpen: s.id === open?.id,
  }));

  const days = Array.from({ length: BASE_DAYS }, (_, i) => addDays(baseDate, i));
  if (open !== undefined && !days.includes(open.base_date)) days.push(open.base_date);
  const dateOptions: OptionItem[] = days.sort().map((d) => ({ value: d, label: date(d, { locale }) }));

  const templateForm = query.tpl === undefined ? blank : templates[query.tpl];
  const form = open === undefined ? templateForm : formOf(open);

  const comparison = open === undefined ? undefined : await comparisonOf(ctx, open, zoneCodeById, locale);

  const scenarioSources: DataSource[] = list.items.map((s) => s.data_source);
  const sources = [...new Set<DataSource>(['SYNTHETIC', ...scenarioSources])];

  return {
    isEmpty: false,
    sources,
    zoneOptions,
    patternOptions,
    dateOptions,
    templates,
    savedRows,
    total: list.items.length,
    openId: open?.id ?? null,
    openIsNew,
    openStatus: open?.status ?? 'draft',
    openLastRunLabel: open?.last_run_at == null ? null : date(open.last_run_at, { locale }),
    openUpdatedLabel: open === undefined ? null : date(open.updated_at, { locale }),
    form,
    comparison,
    unknownId,
  };
}
