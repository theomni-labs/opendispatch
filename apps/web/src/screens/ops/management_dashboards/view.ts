// SPDX-License-Identifier: AGPL-3.0-only
// Management Dashboards view

import { addDays } from '@/lib/day';
import { date } from '@opendispatch/ui/format';
import { listAllCases } from '@/lib/data/cases';
import { getOverCapacity, getOverrideRate, getScheduleAdherence, getUtilization, listDashboardRollups } from '@/lib/data/dashboards';
import type { RequestContext } from '@/lib/data/guard';
import { listCities, listZones } from '@/lib/data/locations';
import { getDemoToday, getSettingsSnapshot } from '@/lib/data/settings';
import type { City, ClockStart, DashboardRollup, DataSource, Zone } from '@/lib/types';
import type { OptionItem, ScopeLevel, StageValue } from './types';

const PAGE = 200;

type CaseScopeFilter = { readonly zone_id?: string | undefined; readonly city_id?: string | undefined };

export interface ManagementDashboardsQuery {
  readonly scope?: ScopeLevel | undefined;
  readonly city?: string | undefined;
  readonly zone?: string | undefined;
}

export interface CompareBar {
  readonly key: string;
  readonly label: string;
  readonly assignPct: number;
  readonly registerPct: number;
}

export interface TrendSeries {
  readonly labels: readonly string[];
  readonly assignPct: readonly number[];
  readonly registerPct: readonly number[];
}

export interface ZoneTableRow {
  readonly zoneId: string;
  readonly name: string;
  readonly code: string;
  readonly stage: StageValue;
  readonly cases: number;
  readonly field: number;
  readonly onShift: number | null;
  readonly assignShare: number | null;
  readonly registerShare: number | null;
  readonly selected: boolean;
  readonly href: string;
}

/** One zone's plan-week row (spec 4.4). */
export interface PlanRow {
  readonly zoneId: string;
  readonly name: string;
  readonly code: string;
  readonly windows: number;
  readonly longestMinutes: number;
  readonly surplusHours: number;
  /** Short agent-hours (gap intervals). */
  readonly shortHours: number | null;
  /** Overridden share of assignments (spec 8); null: none. */
  readonly overrideShare: number | null;
}

/** The plan week: today and the next 6 days. */
export interface PlanWeek {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly rows: readonly PlanRow[];
  readonly overrideTarget: number;
}

/** One zone's utilization (spec 8). */
export interface UtilRow {
  readonly zoneId: string;
  readonly name: string;
  readonly code: string;
  readonly share: number | null;
  /** Share by shift code. */
  readonly shifts: Readonly<Record<string, number | null>>;
  /** Change in points by shift code. */
  readonly shiftChanges: Readonly<Record<string, number | null>>;
  readonly baselineShare: number | null;
  readonly changePoints: number | null;
}

/** Utilization over the 7 days. */
export interface UtilWeek {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly shiftCodes: readonly string[];
  readonly rows: readonly UtilRow[];
  /** Some days had no roster: home shifts. */
  readonly fromHomeShifts: boolean;
  /** Baseline period labels; null: imported share or none. */
  readonly baseFromLabel: string | null;
  readonly baseToLabel: string | null;
  readonly targetPoints: number;
}

/** Forecast against cases, 7 days. */
export interface ForecastSeries {
  readonly labels: readonly string[];
  readonly cases: readonly number[];
  /** Null: no stored forecast for a day of the scope. */
  readonly forecast: readonly number[] | null;
}

/** One zone's adherence on the day. */
export interface AdherenceRow {
  readonly zoneId: string;
  readonly name: string;
  readonly code: string;
  readonly planned: number;
  readonly actual: number | null;
  readonly share: number | null;
  readonly late: number | null;
  readonly absent: number | null;
}

/** Planned against actual on duty (spec 5). */
export interface AdherenceDay {
  readonly dayLabel: string;
  readonly share: number | null;
  readonly labels: readonly string[];
  readonly planned: readonly number[];
  /** Null: no attendance data. */
  readonly actual: readonly number[] | null;
  readonly rows: readonly AdherenceRow[];
}

export interface HeadlineStats {
  readonly cases: number;
  readonly fieldCases: number;
  readonly onShift: number | null;
  readonly registeredToAssignedSeconds: number | null;
  readonly clockStart: ClockStart;
  readonly assignShare: number | null;
  readonly registerShare: number | null;
  readonly targetShare: number | null;
}

export interface ManagementDashboardsView {
  readonly isEmpty: boolean;
  readonly sources: readonly DataSource[];
  readonly dayLabel: string;
  readonly scope: ScopeLevel;
  readonly cityOptions: readonly OptionItem[];
  readonly zoneOptions: readonly OptionItem[];
  readonly cityValue: string;
  readonly zoneValue: string;
  readonly stats: HeadlineStats;
  readonly compareIsCities: boolean;
  readonly compareRows: readonly CompareBar[];
  readonly trend: TrendSeries;
  readonly zoneRows: readonly ZoneTableRow[];
  readonly plan: PlanWeek | null;
  readonly util: UtilWeek | null;
  readonly forecast: ForecastSeries;
  readonly adherence: AdherenceDay | null;
}

// ---- Pure helpers ----

/** `extra.code`, else the id (no code set). */
function extraCode(record: { readonly extra?: Readonly<Record<string, unknown>> | undefined }, fallback: string): string {
  const code = record.extra?.['code'];
  return typeof code === 'string' ? code : fallback;
}

function localizedName(record: { readonly name_en: string; readonly name_ar?: string | null | undefined }, locale: 'en' | 'ar'): string {
  return locale === 'ar' && record.name_ar !== null && record.name_ar !== undefined && record.name_ar.trim() !== '' ? record.name_ar : record.name_en;
}

// A day string, `days` days later (negative ok).

/** Median of a list of durations, seconds. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

/** Share (0-1) as a percent; null reads as 0. */
function pctOf(share: number | null | undefined): number {
  return share === null || share === undefined ? 0 : Math.round(share * 1000) / 10;
}

/** Registered-to-assigned median, from cases. */
async function registeredToAssignedMedian(ctx: RequestContext, day: string, filter: CaseScopeFilter): Promise<number | null> {
  const cases = await listAllCases(ctx, { ...filter, date_from: day, date_to: day });
  const withAssignment = cases.filter((c): c is (typeof cases)[number] & { assigned_at: string } => typeof c.assigned_at === 'string');
  const seconds = withAssignment.map((c) => (Date.parse(c.assigned_at) - Date.parse(c.registered_at)) / 1000);
  return median(seconds);
}

// One point per day, oldest first, x100
function trendOf(rows: readonly DashboardRollup[], from: string): TrendSeries {
  const byDay = new Map(rows.filter((r) => r.period_start === r.period_end).map((r) => [r.period_start, r] as const));
  const labels: string[] = [];
  const assignPct: number[] = [];
  const registerPct: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(from, i);
    const row = byDay.get(day);
    labels.push(String(Number(day.slice(8))));
    assignPct.push(pctOf(row?.from_assignment.share));
    registerPct.push(pctOf(row?.from_registration.share));
  }
  return { labels, assignPct, registerPct };
}

function emptyStats(): HeadlineStats {
  return { cases: 0, fieldCases: 0, onShift: null, registeredToAssignedSeconds: null, clockStart: 'assignment', assignShare: null, registerShare: null, targetShare: null };
}

function emptyView(
  sources: readonly DataSource[],
  dayLabel: string,
  scope: ScopeLevel,
  cityOptions: readonly OptionItem[],
  zoneOptions: readonly OptionItem[],
  cityValue: string,
  zoneValue: string,
): ManagementDashboardsView {
  return {
    isEmpty: true,
    sources,
    dayLabel,
    scope,
    cityOptions,
    zoneOptions,
    cityValue,
    zoneValue,
    stats: emptyStats(),
    compareIsCities: scope === 'kingdom',
    compareRows: [],
    trend: { labels: [], assignPct: [], registerPct: [] },
    zoneRows: [],
    plan: null,
    util: null,
    forecast: { labels: [], cases: [], forecast: null },
    adherence: null,
  };
}

// Cases and the stored forecast, one point a day
function forecastOf(rows: readonly DashboardRollup[], from: string): ForecastSeries {
  const byDay = new Map(rows.filter((r) => r.period_start === r.period_end).map((r) => [r.period_start, r] as const));
  const labels: string[] = [];
  const cases: number[] = [];
  const forecast: number[] = [];
  let complete = true;
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(from, i);
    const row = byDay.get(day);
    labels.push(String(Number(day.slice(8))));
    cases.push(row?.cases_total ?? 0);
    const f = row?.forecast_expected_total;
    if (typeof f === 'number') forecast.push(Math.round(f));
    else complete = false;
  }
  return { labels, cases, forecast: complete ? forecast : null };
}

const hhmm = (i: number): string => (i % 4 === 0 ? `${String(i / 4).padStart(2, '0')}:00` : '');

// Adherence on the day, in the zone table's order
async function adherenceOf(ctx: RequestContext, day: string, zoneId: string | undefined, zones: readonly ZoneTableRow[], locale: 'en' | 'ar'): Promise<AdherenceDay> {
  const report = await getScheduleAdherence(ctx, { date_from: day, date_to: day, zone_id: zoneId });
  const byZone = new Map(report.zones.map((z) => [z.zone_id, z] as const));
  const shown = zoneId === undefined ? zones : zones.filter((z) => z.zoneId === zoneId);
  const rows = shown.flatMap((z): AdherenceRow[] => {
    const r = byZone.get(z.zoneId);
    return r === undefined ? [] : [{ zoneId: z.zoneId, name: z.name, code: z.code, planned: r.planned_agent_hours, actual: r.actual_agent_hours, share: r.share, late: r.late_starts, absent: r.absent_shifts }];
  });
  const anyActual = report.intervals.some((i) => i.actual !== null);
  const sumPlanned = rows.reduce((n, r) => n + r.planned, 0);
  const withActual = rows.filter((r) => r.actual !== null);
  const share = zoneId !== undefined ? report.share : withActual.length === 0 || sumPlanned <= 0 ? null : withActual.reduce((n, r) => n + (r.actual ?? 0), 0) / sumPlanned;
  return {
    dayLabel: date(day, { locale }),
    share,
    labels: report.intervals.map((i) => hhmm(i.interval_index)),
    planned: report.intervals.map((i) => i.planned),
    actual: anyActual ? report.intervals.map((i) => i.actual ?? 0) : null,
    rows,
  };
}

// Utilization rows, in the zone table's order.
async function utilWeekOf(ctx: RequestContext, from: string, to: string, zones: readonly ZoneTableRow[], locale: 'en' | 'ar'): Promise<UtilWeek> {
  const report = await getUtilization(ctx, { date_from: from, date_to: to });
  const byZone = new Map(report.zones.map((z) => [z.zone_id, z] as const));
  const codes = new Set<string>();
  let fromHomeShifts = false;
  const base = report.baseline;
  const period = base?.method === 'period' && base.date_from !== null && base.date_to !== null;
  const rows = zones.flatMap((z): UtilRow[] => {
    const r = byZone.get(z.zoneId);
    if (r === undefined) return [];
    if (r.projected_days > 0) fromHomeShifts = true;
    const shifts: Record<string, number | null> = {};
    const shiftChanges: Record<string, number | null> = {};
    for (const s of r.shifts) {
      codes.add(s.code);
      shifts[s.code] = s.share;
      shiftChanges[s.code] = s.change_points ?? null;
    }
    return [{ zoneId: z.zoneId, name: z.name, code: z.code, share: r.share, shifts, shiftChanges, baselineShare: r.baseline_share ?? null, changePoints: r.change_points ?? null }];
  });
  return {
    fromLabel: date(from, { locale }),
    toLabel: date(to, { locale }),
    shiftCodes: [...codes].sort().slice(0, 3),
    rows,
    fromHomeShifts,
    baseFromLabel: period ? date(base.date_from as string, { locale }) : null,
    baseToLabel: period ? date(base.date_to as string, { locale }) : null,
    targetPoints: base?.target_points ?? 10,
  };
}

// Plan-week rows, in the zone table's order.
async function planWeekOf(ctx: RequestContext, today: string, zones: readonly ZoneTableRow[], locale: 'en' | 'ar'): Promise<PlanWeek> {
  const to = addDays(today, 6);
  const report = await getOverCapacity(ctx, { date_from: today, date_to: to });
  const overrides = await getOverrideRate(ctx, { date_from: today, date_to: to });
  const byZone = new Map(report.zones.map((z) => [z.zone_id, z] as const));
  const shareByZone = new Map(overrides.zones.map((z) => [z.zone_id ?? '', z.share] as const));
  const rows = zones.flatMap((z): PlanRow[] => {
    const r = byZone.get(z.zoneId);
    return r === undefined
      ? []
      : [{ zoneId: z.zoneId, name: z.name, code: z.code, shortHours: r.short_agent_hours ?? null, windows: r.window_count, longestMinutes: r.longest_minutes, surplusHours: r.surplus_agent_hours, overrideShare: shareByZone.get(z.zoneId) ?? null }];
  });
  return { fromLabel: date(today, { locale }), toLabel: date(to, { locale }), rows, overrideTarget: overrides.target_share };
}

// ---- Loader ----

export async function loadManagementDashboardsView(ctx: RequestContext, query: ManagementDashboardsQuery, locale: 'en' | 'ar'): Promise<ManagementDashboardsView> {
  const today = await getDemoToday(ctx);
  const day = addDays(today, -1);
  const scope: ScopeLevel = query.scope ?? 'kingdom';

  const cities = (await listCities(ctx, { limit: PAGE })).items;
  const zones = (await listZones(ctx, { limit: PAGE })).items;
  const cityOrder = new Map(cities.map((c, i) => [c.id, i] as const));
  const zoneOrder = new Map(zones.map((z, i) => [z.id, i] as const));
  const cityOptions: OptionItem[] = cities.map((c) => ({ value: c.id, label: localizedName(c, locale) }));
  const zoneOptions: OptionItem[] = zones.map((z) => ({ value: z.id, label: localizedName(z, locale) }));
  const dayLabel = date(day, { locale });

  let selectedCity: City | undefined;
  let selectedZone: Zone | undefined;
  if (scope === 'city') {
    selectedCity = (query.city === undefined ? undefined : cities.find((c) => c.id === query.city)) ?? cities[0];
  } else if (scope === 'zone') {
    const zone = (query.zone === undefined ? undefined : zones.find((z) => z.id === query.zone)) ?? zones[0];
    selectedZone = zone;
    if (zone !== undefined) selectedCity = cities.find((c) => c.id === zone.city_id);
  }
  const cityValue = selectedCity?.id ?? '';
  const zoneValue = selectedZone?.id ?? '';

  if ((scope === 'city' && selectedCity === undefined) || (scope === 'zone' && selectedZone === undefined)) {
    return emptyView(['SYNTHETIC'], dayLabel, scope, cityOptions, zoneOptions, cityValue, zoneValue);
  }

  const level = scope;
  const scopeId = scope === 'city' ? selectedCity?.id : scope === 'zone' ? selectedZone?.id : undefined;

  const headline = (await listDashboardRollups(ctx, {
    level,
    ...(scopeId === undefined ? {} : { scope_id: scopeId }),
    date_from: day,
    date_to: day,
    limit: PAGE,
  })).items[0];
  if (headline === undefined) {
    return emptyView(['SYNTHETIC'], dayLabel, scope, cityOptions, zoneOptions, cityValue, zoneValue);
  }

  const zoneById = new Map(zones.map((z) => [z.id, z] as const));
  const settings = await getSettingsSnapshot(ctx);
  const stageByZone = new Map(settings.live_assignment_stages.map((s) => [s.zone_id, s.stage] as const));
  const zoneDayRows = (await listDashboardRollups(ctx, { level: 'zone', date_from: day, date_to: day, limit: PAGE })).items;

  const filterCityId = scope === 'kingdom' ? undefined : selectedCity?.id;
  const zoneTableSource = zoneDayRows.filter((r) => {
    if (filterCityId === undefined) return true;
    const zone = zoneById.get(r.scope_id ?? '');
    return zone !== undefined && zone.city_id === filterCityId;
  });
  const sortedZoneRows = [...zoneTableSource].sort((a, b) => (zoneOrder.get(a.scope_id ?? '') ?? 0) - (zoneOrder.get(b.scope_id ?? '') ?? 0));

  const zoneRows: ZoneTableRow[] = sortedZoneRows.flatMap((r): ZoneTableRow[] => {
    const zone = zoneById.get(r.scope_id ?? '');
    if (zone === undefined) return [];
    return [
      {
        zoneId: zone.id,
        name: localizedName(zone, locale),
        code: extraCode(zone, zone.id),
        stage: stageByZone.get(zone.id) ?? 'shadow',
        cases: r.cases_total,
        field: r.cases_field,
        onShift: r.agents_on_duty ?? null,
        assignShare: r.from_assignment.share,
        registerShare: r.from_registration.share,
        selected: scope === 'zone' && selectedZone?.id === zone.id,
        href: `?scope=zone&zone=${zone.id}`,
      },
    ];
  });

  const compareIsCities = scope === 'kingdom';
  let compareRows: CompareBar[];
  if (compareIsCities) {
    const cityById = new Map(cities.map((c) => [c.id, c] as const));
    const cityDayRows = (await listDashboardRollups(ctx, { level: 'city', date_from: day, date_to: day, limit: PAGE })).items;
    compareRows = [...cityDayRows]
      .sort((a, b) => (cityOrder.get(a.scope_id ?? '') ?? 0) - (cityOrder.get(b.scope_id ?? '') ?? 0))
      .flatMap((r): CompareBar[] => {
        const city = cityById.get(r.scope_id ?? '');
        if (city === undefined) return [];
        return [{ key: city.id, label: localizedName(city, locale), assignPct: pctOf(r.from_assignment.share), registerPct: pctOf(r.from_registration.share) }];
      });
  } else {
    compareRows = zoneRows.map((z) => ({ key: z.zoneId, label: z.code, assignPct: pctOf(z.assignShare), registerPct: pctOf(z.registerShare) }));
  }

  const from = addDays(day, -6);
  const trendScopeRows = (await listDashboardRollups(ctx, {
    level,
    ...(scopeId === undefined ? {} : { scope_id: scopeId }),
    date_from: from,
    date_to: day,
    limit: PAGE,
  })).items;
  const trend = trendOf(trendScopeRows, from);
  const forecast = forecastOf(trendScopeRows, from);

  const caseFilter: CaseScopeFilter = scope === 'zone' ? { zone_id: selectedZone?.id } : scope === 'city' ? { city_id: selectedCity?.id } : {};
  const registeredToAssignedSeconds = await registeredToAssignedMedian(ctx, day, caseFilter);

  const stats: HeadlineStats = {
    cases: headline.cases_total,
    fieldCases: headline.cases_field,
    onShift: headline.agents_on_duty ?? null,
    registeredToAssignedSeconds,
    clockStart: headline.primary_clock_start,
    assignShare: headline.from_assignment.share,
    registerShare: headline.from_registration.share,
    targetShare: settings.service_level_target_share ?? null,
  };

  return {
    isEmpty: false,
    sources: [headline.data_source],
    dayLabel,
    scope,
    cityOptions,
    zoneOptions,
    cityValue,
    zoneValue,
    stats,
    compareIsCities,
    compareRows,
    trend,
    zoneRows,
    plan: await planWeekOf(ctx, today, zoneRows, locale),
    util: await utilWeekOf(ctx, from, day, zoneRows, locale),
    forecast,
    adherence: await adherenceOf(ctx, day, scope === 'zone' ? selectedZone?.id : undefined, zoneRows, locale),
  };
}
