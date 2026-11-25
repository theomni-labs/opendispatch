// SPDX-License-Identifier: AGPL-3.0-only
// Productivity and Metrics view (server only)

import { time } from '@opendispatch/ui/format';
import { getProductivityDurations, getUtilization, listProductivityRollups } from '@/lib/data/dashboards';
import type { RequestContext } from '@/lib/data/guard';
import { chosenClock, primaryClock } from './clock';
import { listZones } from '@/lib/data/locations';
import { listAgents } from '@/lib/data/people';
import { getSettingsSnapshot, primaryReading } from '@/lib/data/settings';
import type { ClockStart, DataSource, DurationDistribution, PageInfo, Zone } from '@/lib/types';
import { CASES_CUTOFF, SPEED_CUTOFF_SECONDS, SORT_COLUMNS, type CasesFilterValue, type ClockValue, type SortColumn, type SpeedFilterValue } from './types';

const PAGE = 200;
const BUCKET_COUNT = 15;
const BLOCK_HOURS = 4;

// Every page of a list read
async function everyPage<T>(fetch: (cursor: string | undefined) => { items: T[]; page: PageInfo } | Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

// extra.code (RD-C), else the name
function zoneCodeOf(zone: Zone | undefined): string {
  if (zone === undefined) return '—';
  const code = zone.extra?.['code'];
  return typeof code === 'string' && code !== '' ? code : zone.name_en;
}

function localizedName(zone: Zone, locale: 'en' | 'ar'): string {
  return locale === 'ar' && zone.name_ar !== null && zone.name_ar.trim() !== '' ? zone.name_ar : zone.name_en;
}

export interface ZoneOption {
  readonly value: string;
  readonly label: string;
}

export interface HistogramView {
  readonly labels: readonly string[];
  readonly counts: readonly number[];
  readonly medianSeconds: number | null;
}

export interface HeatView {
  /** The clock of the setting. */
  readonly clock: ClockValue;
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  readonly values: readonly (number | null)[][];
}

export interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly zoneCode: string;
  readonly cases: number;
  readonly assignedSeconds: number | null;
  readonly registeredSeconds: number | null;
  readonly onSceneSeconds: number | null;
  readonly utilisation: number | null;
}

/** One zone of the By zone table (spec 4.6). */
export interface ZoneMeasureRow {
  readonly zoneId: string;
  readonly name: string;
  readonly code: string;
  readonly cases: number;
  readonly toSceneSeconds: number | null;
  readonly onSceneSeconds: number | null;
  readonly adminSeconds: number | null;
  readonly casesPerShift: number | null;
}

export interface DrawerDay {
  readonly date: string;
  readonly cases: number;
  readonly assignedSeconds: number | null;
  readonly onSceneSeconds: number | null;
}

export interface DrawerView {
  readonly name: string;
  readonly code: string;
  readonly zoneLabel: string;
  readonly cases: number;
  readonly assignedSeconds: number | null;
  readonly registeredSeconds: number | null;
  readonly onSceneSeconds: number | null;
  readonly utilisation: number | null;
  readonly zoneMedianSeconds: number | null;
  readonly days: readonly DrawerDay[];
}

export interface ReadingView {
  readonly clockStart: ClockStart;
  readonly primarySeconds: number | null;
  readonly secondarySeconds: number | null;
  readonly primaryKey: 'from_assignment' | 'from_registration';
  readonly secondaryKey: 'from_assignment' | 'from_registration';
  readonly targetShare: number | null;
}

export interface ProductivityMetricsView {
  readonly isEmpty: boolean;
  readonly sources: readonly DataSource[];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly stats: { readonly cases: number; readonly agents: number; readonly onSceneMedianSeconds: number | null };
  readonly reading: ReadingView;
  readonly zoneOptions: readonly ZoneOption[];
  readonly zone: string;
  readonly clock: ClockValue;
  readonly toScene: HistogramView;
  readonly onScene: HistogramView;
  readonly heat: HeatView;
  readonly zoneRows: readonly ZoneMeasureRow[];
  readonly rows: readonly AgentRow[];
  readonly sort: { readonly key: SortColumn; readonly direction: 'asc' | 'desc' };
  readonly drawer: DrawerView | undefined;
}

export interface ProductivityMetricsQuery {
  readonly zone?: string | undefined;
  readonly clock?: ClockValue | undefined;
  readonly q?: string | undefined;
  readonly fzone?: string | undefined;
  readonly fcases?: CasesFilterValue | undefined;
  readonly fspeed?: SpeedFilterValue | undefined;
  readonly sort?: { readonly key: string; readonly direction: 'asc' | 'desc' } | undefined;
  readonly agent?: string | undefined;
}

function emptyView(clockStart: ClockStart, targetShare: number | null): ProductivityMetricsView {
  const key = clockStart === 'registration' ? 'from_registration' : 'from_assignment';
  const other = key === 'from_assignment' ? 'from_registration' : 'from_assignment';
  return {
    isEmpty: true,
    sources: ['SYNTHETIC'],
    periodStart: '',
    periodEnd: '',
    stats: { cases: 0, agents: 0, onSceneMedianSeconds: null },
    reading: { clockStart, primarySeconds: null, secondarySeconds: null, primaryKey: key, secondaryKey: other, targetShare },
    zoneOptions: [],
    zone: '',
    clock: primaryClock(clockStart),
    toScene: { labels: [], counts: [], medianSeconds: null },
    onScene: { labels: [], counts: [], medianSeconds: null },
    heat: { clock: primaryClock(clockStart), rows: [], columns: [], values: [] },
    zoneRows: [],
    rows: [],
    sort: { key: 'cases', direction: 'desc' },
    drawer: undefined,
  };
}

function sortValueOf(row: AgentRow, key: SortColumn): number | string {
  switch (key) {
    case 'name':
      return row.name;
    case 'zone':
      return row.zoneCode;
    case 'cases':
      return row.cases;
    case 'a':
      return row.assignedSeconds ?? -1;
    case 'r':
      return row.registeredSeconds ?? -1;
    case 's':
      return row.onSceneSeconds ?? -1;
    case 'u':
      return row.utilisation ?? -1;
  }
}

export async function loadProductivityMetricsView(ctx: RequestContext, query: ProductivityMetricsQuery, locale: 'en' | 'ar'): Promise<ProductivityMetricsView> {
  const settings = await getSettingsSnapshot(ctx);
  const clockStart = settings.clock_start;
  const targetShare = settings.service_level_target_share ?? null;
  const zoneRows = await everyPage((cursor) => listProductivityRollups(ctx, { group_by: 'zone', limit: PAGE, cursor }));
  if (zoneRows.length === 0) return emptyView(clockStart, targetShare);

  const agentRows = await everyPage((cursor) => listProductivityRollups(ctx, { group_by: 'agent', limit: PAGE, cursor }));
  const zones = (await listZones(ctx, { limit: PAGE })).items;
  const agents = await everyPage((cursor) => listAgents(ctx, { limit: PAGE, cursor }));
  const zoneById = new Map(zones.map((z) => [z.id, z] as const));
  const agentById = new Map(agents.map((s) => [s.id, s] as const));
  const zoneRollupByZone = new Map(zoneRows.map((r) => [r.zone_id ?? '', r] as const));

  const periodStart = zoneRows[0]?.period_start ?? '';
  const periodEnd = zoneRows[0]?.period_end ?? '';
  const sources = [...new Set(zoneRows.map((r) => r.data_source))];

  // Durations for the period, summarised in SQL.
  const drawerAsked = query.agent !== undefined && agentRows.some((r) => r.agent_id === query.agent) && agentById.has(query.agent);
  const durations = await getProductivityDurations(ctx, { date_from: periodStart, date_to: periodEnd, agent_id: drawerAsked ? query.agent : undefined });
  const overall = durations.overall;

  const zoneOptions: ZoneOption[] = zones.map((z) => ({ value: z.id, label: localizedName(z, locale) }));
  const selectedZoneId = query.zone !== undefined && zoneById.has(query.zone) ? query.zone : undefined;
  const selectedSummary = selectedZoneId === undefined ? overall : durations.zones.find((z) => z.zone_id === selectedZoneId)?.summary;

  function histogramOf(pick: (s: typeof overall) => DurationDistribution): HistogramView {
    const labels = [...Array.from({ length: BUCKET_COUNT }, (_, i) => String(i * 2)), '30+'];
    if (selectedSummary === undefined) return { labels, counts: new Array<number>(BUCKET_COUNT + 1).fill(0), medianSeconds: null };
    const dist = pick(selectedSummary);
    return { labels, counts: [...dist.histogram], medianSeconds: dist.median_seconds };
  }

  const clock: ClockValue = chosenClock(query.clock, clockStart);
  const toScene = histogramOf((s) => (clock === 'a' ? s.from_assignment : s.from_registration));
  const onScene = histogramOf((s) => s.on_scene);

  // Heat cell: zone median minus overall, min
  const heatClock = primaryClock(clockStart);
  const overallHeatMedian = (heatClock === 'a' ? overall.from_assignment.median_seconds : overall.from_registration.median_seconds) ?? 0;
  const cellMedian = new Map<string, number>(
    durations.cells.flatMap((c) => {
      const median = heatClock === 'a' ? c.median_from_assignment_seconds : c.median_from_registration_seconds;
      return c.zone_id === null || median === undefined ? [] : [[`${c.zone_id}|${c.block_start_hour}`, median] as const];
    }),
  );
  const heatColumns = Array.from({ length: 24 / BLOCK_HOURS }, (_, i) => time(i * BLOCK_HOURS * 60));
  const heatRows: string[] = [];
  const heatValues: (number | null)[][] = [];
  for (const zr of zoneRows) {
    heatRows.push(zoneCodeOf(zoneById.get(zr.zone_id ?? '')));
    const row: (number | null)[] = [];
    for (let i = 0; i < heatColumns.length; i += 1) {
      const median = cellMedian.get(`${zr.zone_id}|${i * BLOCK_HOURS}`);
      const delta = median === undefined ? null : Math.round(((overallHeatMedian - median) / 60) * 10) / 10;
      // Normalises -0 to 0: JSON drops the sign.
      row.push(delta === null ? null : delta === 0 ? 0 : delta);
    }
    heatValues.push(row);
  }

  // By zone: durations and cases an agent-shift
  const util = await getUtilization(ctx, { date_from: periodStart.slice(0, 10), date_to: periodEnd.slice(0, 10) });
  const perShift = new Map(util.zones.map((z) => [z.zone_id, z.cases_per_agent_shift ?? null] as const));
  const durByZone = new Map(durations.zones.map((z) => [z.zone_id ?? '', z.summary] as const));
  const zoneMeasureRows: ZoneMeasureRow[] = zoneRows.flatMap((zr): ZoneMeasureRow[] => {
    const zone = zoneById.get(zr.zone_id ?? '');
    if (zone === undefined) return [];
    const s = durByZone.get(zone.id);
    const toScene = s === undefined ? null : heatClock === 'a' ? s.from_assignment.median_seconds : s.from_registration.median_seconds;
    return [{ zoneId: zone.id, name: localizedName(zone, locale), code: zoneCodeOf(zone), cases: s?.cases ?? 0, toSceneSeconds: toScene, onSceneSeconds: s?.on_scene.median_seconds ?? null, adminSeconds: s?.admin?.median_seconds ?? null, casesPerShift: perShift.get(zone.id) ?? null }];
  });

  const fzone = query.fzone !== undefined && zoneById.has(query.fzone) ? query.fzone : undefined;
  const needle = (query.q ?? '').trim().toLowerCase();
  const filteredRollups = agentRows.filter((r) => {
    if (fzone !== undefined && r.zone_id !== fzone) return false;
    if (query.fcases === 'hi' && r.cases_handled < CASES_CUTOFF) return false;
    if (query.fcases === 'lo' && r.cases_handled >= CASES_CUTOFF) return false;
    const a = r.median_assigned_to_arrived_seconds;
    if (query.fspeed === 'fast' && !(typeof a === 'number' && a < SPEED_CUTOFF_SECONDS)) return false;
    if (query.fspeed === 'slow' && !(typeof a === 'number' && a >= SPEED_CUTOFF_SECONDS)) return false;
    if (needle === '') return true;
    const agent = agentById.get(r.agent_id ?? '');
    const hay = `${agent?.name_en ?? ''} ${agent?.name_ar ?? ''} ${agent?.code ?? ''}`.toLowerCase();
    return hay.includes(needle);
  });

  const rowsUnsorted: AgentRow[] = filteredRollups.map((r) => ({
    id: r.agent_id ?? r.id,
    name: agentById.get(r.agent_id ?? '')?.name_en ?? '—',
    code: agentById.get(r.agent_id ?? '')?.code ?? '—',
    zoneCode: zoneCodeOf(zoneById.get(r.zone_id ?? '')),
    cases: r.cases_handled,
    assignedSeconds: r.median_assigned_to_arrived_seconds ?? null,
    registeredSeconds: r.median_registered_to_arrived_seconds ?? null,
    onSceneSeconds: r.median_time_on_scene_seconds ?? null,
    utilisation: r.utilisation ?? null,
  }));

  const sortKey: SortColumn = query.sort !== undefined && (SORT_COLUMNS as readonly string[]).includes(query.sort.key) ? (query.sort.key as SortColumn) : 'cases';
  const sortDir = query.sort?.direction ?? 'desc';
  const dir = sortDir === 'asc' ? 1 : -1;
  const rows = [...rowsUnsorted].sort((x, y) => {
    const a = sortValueOf(x, sortKey);
    const b = sortValueOf(y, sortKey);
    const cmp = typeof a === 'string' ? a.localeCompare(b as string) : (a as number) - (b as number);
    return (cmp || x.name.localeCompare(y.name)) * dir;
  });

  const pr = primaryReading(clockStart, { from_assignment: overall.from_assignment.median_seconds, from_registration: overall.from_registration.median_seconds });
  const reading: ReadingView = { clockStart: pr.clock_start, primarySeconds: pr.primary, secondarySeconds: pr.secondary, primaryKey: pr.primary_key, secondaryKey: pr.secondary_key, targetShare };

  // Drawer target: one agent week
  let drawer: DrawerView | undefined;
  if (drawerAsked && query.agent !== undefined) {
    const rollup = agentRows.find((r) => r.agent_id === query.agent);
    const agent = agentById.get(query.agent);
    if (rollup !== undefined && agent !== undefined) {
      const zone = zoneById.get(rollup.zone_id ?? '');
      const zoneRollup = zoneRollupByZone.get(rollup.zone_id ?? '');
      // One day of the agent week
      const days: DrawerDay[] = durations.days.map((d) => ({ date: d.date, cases: d.cases, assignedSeconds: d.median_from_assignment_seconds, onSceneSeconds: d.median_on_scene_seconds }));
      drawer = {
        name: agent.name_en,
        code: agent.code,
        zoneLabel: zone === undefined ? '—' : localizedName(zone, locale),
        cases: rollup.cases_handled,
        assignedSeconds: rollup.median_assigned_to_arrived_seconds ?? null,
        registeredSeconds: rollup.median_registered_to_arrived_seconds ?? null,
        onSceneSeconds: rollup.median_time_on_scene_seconds ?? null,
        utilisation: rollup.utilisation ?? null,
        zoneMedianSeconds: zoneRollup?.median_assigned_to_arrived_seconds ?? null,
        days,
      };
    }
  }

  return {
    isEmpty: false,
    sources,
    periodStart,
    periodEnd,
    stats: { cases: zoneRows.reduce((sum, r) => sum + r.cases_handled, 0), agents: agentRows.length, onSceneMedianSeconds: overall.on_scene.median_seconds },
    reading,
    zoneOptions,
    zone: selectedZoneId ?? '',
    clock,
    toScene,
    onScene,
    heat: { clock: heatClock, rows: heatRows, columns: heatColumns, values: heatValues },
    zoneRows: zoneMeasureRows,
    rows,
    sort: { key: sortKey, direction: sortDir },
    drawer,
  };
}
