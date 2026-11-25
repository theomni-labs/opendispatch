// SPDX-License-Identifier: AGPL-3.0-only
// Gap and Surplus view (server only)

import { date, formatPercent, time } from '@opendispatch/ui/format';
import { moduleAccess } from '@/lib/access';
import type { RequestContext } from '@/lib/data/guard';
import { listCities, listZones } from '@/lib/data/locations';
import { getGapSurplus } from '@/lib/data/rosters';
import { getSettingsSnapshot } from '@/lib/data/settings';
import type { City, DataSource, Zone } from '@/lib/types';
import { moduleHref } from '@/i18n/module-routes';
import type { CauseValue, Density } from './types';
import { cellMetShare, cellOutOfReach, cellValue, type ShowValue } from './kpi';
import { gapStats, type CauseCounts, type StatsView } from './stats';
import { isolateLtr } from '@/components/opendispatch/isolateLtr';

const PAGE = 200;

/** Not exported from lib/types (a nested schema, not a top-level one); derived from the real read instead. */
type GapCell = Awaited<ReturnType<typeof getGapSurplus>>['cells'][number];

export interface CityOption {
  readonly value: string;
  readonly label: string;
}

export interface ZoneOption {
  readonly value: string;
  readonly label: string;
}

export type { CauseCounts, StatsView, WorstGap } from './stats';

export interface GridModel {
  readonly zoneIds: readonly string[];
  readonly rowLabels: readonly string[];
  readonly columns: readonly string[];
  /** `values[row][column]`; null leaves a cell blank (filtered out by the cause chip). */
  readonly values: readonly (number | null)[][];
  /** The real 0-95 interval index behind each displayed cell, for the drawer. */
  readonly intervalIndex: readonly number[][];
  readonly show: ShowValue;
  readonly compact: boolean;
  readonly minColWidth: number;
  readonly anyVisible: boolean;
}

export interface DrawerDetail {
  readonly zoneName: string;
  readonly zoneCode: string;
  readonly rangeLabel: string;
  readonly kind: GapCell['kind'];
  readonly required: number;
  readonly planned: number;
  readonly delta: number;
  readonly cause: GapCell['cause'];
  /** The data layer's own generated sentence, English only (same convention as Standby Coverage's recommended move). */
  readonly causeDetailEn: string | null;
  /** Reach share and target, formatted; null when absent. */
  readonly reachLabel: string | null;
  readonly targetLabel: string | null;
  /** Demand met and out of reach, formatted. */
  readonly metLabel: string;
  readonly outLabel: string | null;
  readonly linkHref: string | null;
  readonly linkIsStandby: boolean;
  /** How required was counted for this zone. */
  readonly basis: ZoneBasis | null;
}

/** One zone's required basis. */
export type ZoneBasis =
  | { readonly method: 'rate_convention'; readonly casesPerInterval: number }
  | { readonly method: 'duration'; readonly minutes: number; readonly travel: number; readonly onScene: number; readonly admin: number };

/** The line under the grid: method and sick-leave provision. */
export interface BasisView {
  readonly method: 'rate_convention' | 'duration';
  readonly minutesFrom: number | null;
  readonly minutesTo: number | null;
  readonly sickDays: number;
}

export interface GapSurplusView {
  readonly isEmpty: boolean;
  /** The day shown, YYYY-MM-DD (filled view only). */
  readonly rosterDate?: string | undefined;
  readonly sources: readonly DataSource[];
  readonly dateLabel: string;
  readonly stats: StatsView;
  readonly cityOptions: readonly CityOption[];
  readonly zoneOptions: readonly ZoneOption[];
  readonly causeCounts: CauseCounts;
  readonly density: Density;
  readonly cause: CauseValue | undefined;
  readonly grid: GridModel;
  readonly canOpenFieldPlanner: boolean;
  readonly canOpenStandby: boolean;
  readonly fieldPlannerHref: string;
  readonly standbyHref: string;
  readonly emptyActionHref: string | null;
  readonly drawer: DrawerDetail | undefined;
  readonly basis: BasisView | null;
}

export interface GapSurplusQuery {
  readonly city?: string | undefined;
  readonly zone?: string | undefined;
  readonly cause?: CauseValue | undefined;
  readonly dens?: Density | undefined;
  readonly show?: ShowValue | undefined;
  readonly q?: string | undefined;
  readonly cell?: string | undefined;
  readonly date?: string | undefined;
}

// ---- Pure helpers ----

function extraCode(record: { readonly extra?: Readonly<Record<string, unknown>> | undefined }, fallback: string): string {
  const code = record.extra?.['code'];
  return typeof code === 'string' ? code : fallback;
}

function localizedName(record: { readonly name_en: string; readonly name_ar?: string | null | undefined }, locale: 'en' | 'ar'): string {
  return locale === 'ar' && record.name_ar !== null && record.name_ar !== undefined && record.name_ar.trim() !== '' ? record.name_ar : record.name_en;
}

interface ZoneRow {
  readonly zoneId: string;
  readonly code: string;
  readonly label: string;
  readonly cells: readonly GapCell[];
}

/** The grid's rows and columns for the chosen density: every quarter hour, or the worst quarter of each hour. */
function buildGrid(rows: readonly ZoneRow[], cause: CauseValue | undefined, density: Density, show: ShowValue): GridModel {
  const zoneIds = rows.map((r) => r.zoneId);
  const rowLabels = rows.map((r) => r.label);
  const keep = (cell: GapCell): boolean => cause === undefined || cell.cause === cause;

  if (density === 'h') {
    const columns = Array.from({ length: 24 }, (_, h) => time(h * 60));
    const values: (number | null)[][] = [];
    const intervalIndex: number[][] = [];
    for (const row of rows) {
      const vRow: (number | null)[] = [];
      const iRow: number[] = [];
      for (let h = 0; h < 24; h += 1) {
        let best: GapCell | undefined;
        for (let k = 0; k < 4; k += 1) {
          const cell = row.cells[h * 4 + k];
          if (cell === undefined || !keep(cell)) continue;
          if (show !== 'delta') {
            // Worst quarter: the highest share
            const v = cellValue(cell, show);
            const b = best === undefined ? null : cellValue(best, show);
            if (v !== null && (b === null || v > b)) best = cell;
            continue;
          }
          if (best === undefined || cell.delta < best.delta || (best.delta >= 0 && cell.delta > best.delta)) best = cell;
        }
        vRow.push(best === undefined ? null : cellValue(best, show));
        iRow.push(best?.interval_index ?? h * 4);
      }
      values.push(vRow);
      intervalIndex.push(iRow);
    }
    return { zoneIds, rowLabels, columns, values, intervalIndex, show, compact: false, minColWidth: 44, anyVisible: values.some((r) => r.some((v) => v !== null)) };
  }

  const columns = Array.from({ length: 96 }, (_, i) => (i % 4 === 0 ? String(Math.floor(i / 4)).padStart(2, '0') : ''));
  const values = rows.map((row) => row.cells.map((cell) => (keep(cell) ? cellValue(cell, show) : null)));
  const intervalIndex = rows.map((row) => row.cells.map((cell) => cell.interval_index));
  return { zoneIds, rowLabels, columns, values, intervalIndex, show, compact: true, minColWidth: 9, anyVisible: values.some((r) => r.some((v) => v !== null)) };
}

function emptyView(sources: readonly DataSource[], dateLabel: string, canOpenFieldPlanner: boolean, canOpenStandby: boolean, fieldPlannerHref: string, standbyHref: string): GapSurplusView {
  return {
    isEmpty: true,
    sources,
    dateLabel,
    stats: { gaps: 0, surplus: 0, worst: null, mainCause: null, met: null, outOfReach: null },
    cityOptions: [],
    zoneOptions: [],
    causeCounts: { people: 0, vehicles: 0, geography: 0 },
    density: 'q',
    cause: undefined,
    grid: { zoneIds: [], rowLabels: [], columns: [], values: [], intervalIndex: [], show: 'delta', compact: true, minColWidth: 9, anyVisible: false },
    canOpenFieldPlanner,
    canOpenStandby,
    fieldPlannerHref,
    standbyHref,
    emptyActionHref: canOpenFieldPlanner ? fieldPlannerHref : null,
    drawer: undefined,
    basis: null,
  };
}

type Staffing = NonNullable<Awaited<ReturnType<typeof getGapSurplus>>['required_staffing']>;

/** A zone's basis, from the view's required_staffing. */
function zoneBasis(staffing: Staffing | undefined, zoneId: string): ZoneBasis | null {
  const row = staffing?.zones.find((z) => z.zone_id === zoneId);
  if (staffing === undefined || row === undefined) return null;
  if (staffing.method === 'rate_convention' || row.minutes_per_case === null) return { method: 'rate_convention', casesPerInterval: row.cases_per_agent_per_interval };
  return { method: 'duration', minutes: Math.round(row.minutes_per_case), travel: Math.round(row.travel_minutes ?? 0), onScene: Math.round(row.on_scene_minutes ?? 0), admin: Math.round(staffing.admin_minutes ?? 0) };
}

/** The line under the grid, over the zones shown. */
function basisOf(staffing: Staffing | undefined, zoneIds: readonly string[]): BasisView | null {
  if (staffing === undefined) return null;
  const minutes = staffing.zones.filter((z) => zoneIds.includes(z.zone_id) && z.minutes_per_case !== null).map((z) => Math.round(z.minutes_per_case as number));
  const duration = staffing.method === 'duration' && minutes.length > 0;
  return {
    method: duration ? 'duration' : 'rate_convention',
    minutesFrom: duration ? Math.min(...minutes) : null,
    minutesTo: duration ? Math.max(...minutes) : null,
    sickDays: staffing.sick_leave_days_per_fte_year,
  };
}

function outLabelOf(cell: GapCell, locale: 'en' | 'ar'): string | null {
  const out = cellOutOfReach(cell);
  return out === null ? null : isolateLtr(formatPercent(out, locale));
}

// ---- Loader ----

export async function loadGapSurplusView(ctx: RequestContext, query: GapSurplusQuery, locale: 'en' | 'ar'): Promise<GapSurplusView> {
  const fieldPlannerHref = moduleHref({ id: 'ops.field_planner', console: 'ops' });
  const standbyHref = moduleHref({ id: 'ops.standby_coverage', console: 'ops' });
  const canOpenFieldPlanner = moduleAccess(ctx.role, 'ops.field_planner', ctx.installMode).access !== 'none';
  const canOpenStandby = moduleAccess(ctx.role, 'ops.standby_coverage', ctx.installMode).access !== 'none';

  const gapView = await getGapSurplus(ctx, query.date === undefined ? {} : { date: query.date });
  const sources: DataSource[] = [gapView.data_source];
  const dateLabel = date(gapView.roster_date, { locale });

  if (gapView.cells.length === 0) {
    return emptyView(sources, dateLabel, canOpenFieldPlanner, canOpenStandby, fieldPlannerHref, standbyHref);
  }

  const zones = (await listZones(ctx, { limit: PAGE })).items;
  const cities = (await listCities(ctx, { limit: PAGE })).items;

  const cellsByZone = new Map<string, GapCell[]>();
  for (const cell of gapView.cells) {
    const list = cellsByZone.get(cell.zone_id);
    if (list === undefined) cellsByZone.set(cell.zone_id, [cell]);
    else list.push(cell);
  }
  for (const list of cellsByZone.values()) list.sort((a, b) => a.interval_index - b.interval_index);

  const cityOptions: CityOption[] = cities.map((c: City) => ({ value: c.case_code, label: localizedName(c, locale) }));
  const selectedCity = query.city === undefined ? undefined : cities.find((c) => c.case_code === query.city);

  const zoneOptions: ZoneOption[] = zones
    .filter((z) => selectedCity === undefined || z.city_id === selectedCity.id)
    .map((z: Zone) => ({ value: z.id, label: localizedName(z, locale) }));

  const requestedZone = query.zone === undefined ? undefined : zones.find((z) => z.id === query.zone);
  const selectedZone = requestedZone !== undefined && (selectedCity === undefined || requestedZone.city_id === selectedCity.id) ? requestedZone : undefined;

  const needle = query.q?.trim().toLowerCase() ?? '';
  const visibleZones = zones.filter((z) => {
    if (selectedCity !== undefined && z.city_id !== selectedCity.id) return false;
    if (selectedZone !== undefined && z.id !== selectedZone.id) return false;
    if (needle === '') return true;
    const code = extraCode(z, z.id).toLowerCase();
    const name = `${z.name_en} ${z.name_ar ?? ''}`.toLowerCase();
    return name.includes(needle) || code.includes(needle);
  });

  const rows: ZoneRow[] = visibleZones.map((z) => ({ zoneId: z.id, code: extraCode(z, z.id), label: localizedName(z, locale), cells: cellsByZone.get(z.id) ?? [] }));

  const { stats, causeCounts } = gapStats(rows, query.cause);

  const density: Density = query.dens ?? 'q';
  const grid = buildGrid(rows, query.cause, density, query.show ?? 'delta');

  let drawer: DrawerDetail | undefined;
  if (query.cell !== undefined) {
    const sep = query.cell.lastIndexOf(':');
    const zoneId = sep === -1 ? '' : query.cell.slice(0, sep);
    const index = sep === -1 ? Number.NaN : Number(query.cell.slice(sep + 1));
    const zone = zones.find((z) => z.id === zoneId);
    const cell = zone === undefined || !Number.isInteger(index) ? undefined : cellsByZone.get(zone.id)?.[index];
    if (zone !== undefined && cell !== undefined) {
      const isGeo = cell.cause === 'geography';
      const linkAllowed = isGeo ? canOpenStandby : canOpenFieldPlanner;
      const target = cell.reach_share === undefined ? undefined : (await getSettingsSnapshot(ctx)).service_level_target_share;
      drawer = {
        zoneName: localizedName(zone, locale),
        zoneCode: extraCode(zone, zone.id),
        rangeLabel: `${time(cell.interval_index * 15)}–${time((cell.interval_index + 1) * 15)}`,
        kind: cell.kind,
        required: cell.required,
        planned: cell.planned,
        delta: cell.delta,
        cause: cell.cause,
        causeDetailEn: cell.cause_detail ?? null,
        reachLabel: cell.reach_share === undefined ? null : isolateLtr(formatPercent(cell.reach_share, locale)),
        targetLabel: target === undefined ? null : isolateLtr(formatPercent(target, locale)),
        metLabel: isolateLtr(formatPercent(cellMetShare(cell), locale)),
        outLabel: outLabelOf(cell, locale),
        linkHref: linkAllowed ? (isGeo ? standbyHref : fieldPlannerHref) : null,
        linkIsStandby: isGeo,
        basis: zoneBasis(gapView.required_staffing, zone.id),
      };
    }
  }

  return {
    isEmpty: false,
    rosterDate: gapView.roster_date,
    sources,
    dateLabel,
    stats,
    cityOptions,
    zoneOptions,
    causeCounts,
    density,
    cause: query.cause,
    grid,
    canOpenFieldPlanner,
    canOpenStandby,
    fieldPlannerHref,
    standbyHref,
    emptyActionHref: canOpenFieldPlanner ? fieldPlannerHref : null,
    drawer,
    basis: basisOf(gapView.required_staffing, rows.map((r) => r.zoneId)),
  };
}
