// SPDX-License-Identifier: AGPL-3.0-only
// View model for Forecast Explorer (module 1, flow
// 1). SERVER ONLY: reads lib/data via ModuleRoute's
// context; Screen.tsx picks the message for a key.
//
// Every figure here is Illustrative: the
// forecast run and values are placeholders. The
// split is the run's stored one; a new
// run applies the approved rules; "with draft"
// previews the first draft as if approved.
// Previewing a draft needs Classification Rules
// view access too:
// a role with Forecast Explorer view but not that
// (dispatcher, planner, remote_team_lead,
// viewer_auditor) never calls listRules and simply
// doesn't get the "With draft" choice.

import { dateBoth, int, time, weekday } from '@opendispatch/ui/format';
import { moduleAccess } from '@/lib/access';
import { getForecastSplit, getForecastTimeline, listForecastRuns, listForecastValues } from '@/lib/data/forecast';
import { listCities, listSubZones, listZones } from '@/lib/data/locations';
import { getDemoToday } from '@/lib/data/settings';
import { listPrayerTimes } from '@/lib/data/time';
import { listRules, listRuleVersions } from '@/lib/data/rules';
import type { RequestContext } from '@/lib/data/guard';
import type { DataSource, ForecastRun, SubZone } from '@/lib/types';
import { otherDayOf, pickDay, stripDates } from './days';
import { runSources } from './sources';
import { scopeSplit, type SplitView, type SubZoneScope } from './split';
import { forecastStats, peakOf, seriesOf } from './stats';

export type { SplitView } from './split';

export interface PickerOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** True when the name is the English one on an Arabic page. */
  readonly fallback?: boolean;
}

/** The Arabic name when the data has one, else the English one marked as a fallback. */
export function localName(row: { readonly name_en: string; readonly name_ar?: string | null }, locale: 'en' | 'ar'): { readonly name: string; readonly fallback: boolean } {
  const ar = row.name_ar?.trim() ?? '';
  return locale === 'ar' && ar !== '' ? { name: ar, fallback: false } : { name: row.name_en, fallback: locale === 'ar' };
}

export interface DayOption {
  readonly value: string;
  readonly label: string;
  readonly tooltip: string;
}

export interface TimelineSeries {
  readonly labels: readonly string[];
  readonly low: readonly number[];
  readonly expected: readonly number[];
  readonly high: readonly number[];
}

/** `code` is the sub-zone's own short code (RD-C-01): the map's click identifier, matched against `sub` (view.ts uses
 * the code, not the id, as the URL's `?sub=` value, so a click on the map and a change of the select agree). */
export interface FxMapZone {
  readonly code: string;
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
  readonly radiusKm: number;
  readonly heat: 1 | 2 | 3 | 4 | 5;
  readonly active: boolean;
}

/** All sub-zone circles are drawn at this radius (SubZone carries no size of its own, unlike Zone's extra.radius_km). */
const SUB_ZONE_RADIUS_KM = 1.7;

export interface TopRow {
  readonly code: string;
  readonly name: string;
  readonly fallback?: boolean;
  readonly value: number;
  readonly shareOfMax: number;
}

export interface PrayerRow {
  readonly key: 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
  readonly time: string;
}

export interface ForecastExplorerView {
  readonly cities: readonly PickerOption[];
  readonly zones: readonly PickerOption[];
  readonly subZones: readonly PickerOption[];
  readonly days: readonly DayOption[];
  readonly city: string;
  readonly zone: PickerOption;
  readonly sub: string;
  readonly day: string;
  readonly time: number;
  readonly view: 'total' | 'field' | 'remote';
  readonly rules: 'active' | 'draft';
  readonly run: { readonly version: string; readonly generatedAt: string; readonly rangeCoverage: number } | undefined;
  readonly hasForecast: boolean;
  readonly otherDay: string | null;
  readonly stats: { readonly expected: number; readonly peakIndex: number; readonly peakValue: number; readonly rangeLow: number; readonly rangeHigh: number };
  readonly mapZones: readonly FxMapZone[];
  readonly top: readonly TopRow[];
  readonly split: SplitView;
  readonly timeline: TimelineSeries;
  readonly prayers: readonly PrayerRow[];
  readonly sources: readonly DataSource[];
  readonly canOpenModelAdmin: boolean;
  readonly canOpenClassificationRules: boolean;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

function intervalStartOf(date: string, index: number): string {
  const hh = String(Math.floor(index / 4)).padStart(2, '0');
  const mm = String((index % 4) * 15).padStart(2, '0');
  return `${date}T${hh}:${mm}:00+03:00`;
}

function hhmm(index: number): string {
  return time(index * 15);
}

function extraCode(record: { readonly extra?: Readonly<Record<string, unknown>> | undefined }, fallback: string): string {
  return typeof record.extra?.['code'] === 'string' ? (record.extra['code'] as string) : fallback;
}

// ---------------------------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------------------------

export interface ForecastExplorerQuery {
  readonly city?: string | undefined;
  readonly zone?: string | undefined;
  readonly sub?: string | undefined;
  readonly day?: string | undefined;
  readonly time?: number | undefined;
  readonly view?: 'total' | 'field' | 'remote' | undefined;
  readonly rules?: 'active' | 'draft' | undefined;
}

export async function loadForecastExplorerView(ctx: RequestContext, query: ForecastExplorerQuery, locale: 'en' | 'ar'): Promise<ForecastExplorerView> {
  const cityRows = (await listCities(ctx, { limit: 200 })).items.filter((c) => c.is_active);
  const cities: PickerOption[] = cityRows.map((c) => ({ id: c.id, code: c.case_code, ...localName(c, locale) }));

  // inactive zones are never forecast
  const allZones = (await listZones(ctx, { limit: 200 })).items.filter((z) => z.is_active);
  const wantedCity = query.city !== undefined ? cityRows.find((c) => c.case_code === query.city) : undefined;
  const cityId = (wantedCity ?? cityRows[0])?.id;
  const cityZones = allZones.filter((z) => z.city_id === cityId);
  const requestedZone = query.zone === undefined ? undefined : cityZones.find((z) => z.id === query.zone);
  const zone = requestedZone ?? cityZones[0] ?? allZones[0];

  const today = await getDemoToday(ctx);
  const run = (await listForecastRuns(ctx, { status: 'succeeded', limit: 1 })).items[0];
  const sources = runSources(run);
  // only the run's own days: no derived ones
  const horizon = run === undefined ? undefined : { start: run.horizon_start_date, days: run.horizon_days };
  const days: DayOption[] = stripDates(horizon, today).map((value) => ({
    value,
    label: `${weekday(value, { locale, timeZone: 'Asia/Riyadh' })} ${int(Number(value.slice(8, 10)), locale)}`,
    tooltip: dateBoth(value, { locale, timeZone: 'Asia/Riyadh' }),
  }));
  const day = pickDay(days.map((d) => d.value), query.day, today);
  const zoneCode = zone === undefined ? '' : extraCode(zone, zone.id);

  if (zone === undefined) {
    return {
      cities,
      zones: [],
      subZones: [],
      days,
      city: (wantedCity ?? cityRows[0])?.case_code ?? '',
      zone: { id: '', code: '', name: '' },
      sub: '',
      day,
      time: 0,
      view: query.view ?? 'total',
      rules: 'active',
      run: undefined,
      hasForecast: false,
      otherDay: null,
      stats: { expected: 0, peakIndex: 0, peakValue: 0, rangeLow: 0, rangeHigh: 0 },
      mapZones: [],
      top: [],
      split: { fieldExpected: 0, remoteExpected: 0, fieldShare: 0, ruleSetVersion: '', canPreviewDraft: false, activeCount: 0, draftCount: 0, previewRuleCode: null },
      timeline: { labels: [], low: [], expected: [], high: [] },
      prayers: [],
      sources,
      canOpenModelAdmin: false,
      canOpenClassificationRules: false,
    };
  }

  const zones: PickerOption[] = cityZones.map((z) => ({ id: z.id, code: extraCode(z, z.id), ...localName(z, locale) })).sort((a, b) => a.name.localeCompare(b.name));
  const subZoneRows = (await listSubZones(ctx, { zone_id: zone.id, limit: 200 })).items.filter((s) => s.is_active);
  // A sub-zone's id everywhere here (URL, select, map
  // click) is its short code, not its row id: the map
  // hands back MapZone.code, so using the code
  // throughout avoids translating back and forth.
  const subZones: PickerOption[] = subZoneRows.map((s) => ({ id: extraCode(s, s.id), code: extraCode(s, s.id), ...localName(s, locale) })).sort((a, b) => a.code.localeCompare(b.code));
  const sub = query.sub !== undefined && subZones.some((s) => s.code === query.sub) ? query.sub : '';
  const subRow = sub === '' ? undefined : subZoneRows.find((s) => extraCode(s, s.id) === sub);

  // ---- Timeline: zone total, or one sub-zone ----
  const { timeline, scope, count } = await timelineFor(ctx, zone.id, subRow?.id, day);
  const totalExpected = timeline.expected;
  const peakIndex = peakOf(totalExpected);
  const time = query.time !== undefined && query.time >= 0 && query.time < totalExpected.length ? query.time : peakIndex;

  // ---- Split (field or remote), active rules or with a draft preview ----
  const canPreviewDraft = moduleAccess(ctx.role, 'admin.classification_rules', ctx.installMode).access !== 'none';
  const split = await splitFor(ctx, zone.id, day, canPreviewDraft, query.rules === 'draft', scope);
  const rulesMode: 'active' | 'draft' = query.rules === 'draft' && split.canPreviewDraft ? 'draft' : 'active';

  // ---- Sub-zone heat and busiest list, at the chosen time ----
  const { mapZones, top } = await heatFor(ctx, zone.id, subZoneRows, day, time, sub, locale);

  // ---- Prayer times ----
  const prayerRow = (await listPrayerTimes(ctx, { city_id: zone.city_id, date_from: day, date_to: day })).items[0];
  const prayers: PrayerRow[] = prayerRow === undefined ? [] : [
    { key: 'fajr', time: prayerRow.fajr },
    { key: 'dhuhr', time: prayerRow.dhuhr },
    { key: 'asr', time: prayerRow.asr },
    { key: 'maghrib', time: prayerRow.maghrib },
    { key: 'isha', time: prayerRow.isha },
  ];

  return {
    cities,
    zones,
    subZones,
    days,
    city: (wantedCity ?? cityRows.find((c) => c.id === zone.city_id))?.case_code ?? cities[0]?.code ?? '',
    zone: { id: zone.id, code: zoneCode, ...localName(zone, locale) },
    sub,
    day,
    time,
    view: query.view ?? 'total',
    rules: rulesMode,
    run: run === undefined ? undefined : runInfoOf(run),
    hasForecast: count > 0,
    otherDay: otherDayOf(horizon, day),
    stats: forecastStats(timeline),
    mapZones,
    top,
    split,
    timeline,
    prayers,
    sources,
    canOpenModelAdmin: moduleAccess(ctx.role, 'admin.forecast_model', ctx.installMode).access !== 'none',
    canOpenClassificationRules: canPreviewDraft,
  };
}

function runInfoOf(run: ForecastRun): { readonly version: string; readonly generatedAt: string; readonly rangeCoverage: number } {
  return { version: run.model_version, generatedAt: run.created_at, rangeCoverage: run.range_coverage };
}

async function timelineFor(ctx: RequestContext, zoneId: string, subZoneId: string | undefined, date: string): Promise<{ readonly timeline: TimelineSeries; readonly scope: SubZoneScope | undefined; readonly count: number }> {
  const labels = Array.from({ length: 96 }, (_, i) => hhmm(i));
  if (subZoneId === undefined) {
    const t = await getForecastTimeline(ctx, { zone_id: zoneId, date });
    return { timeline: { labels, ...seriesOf(t.intervals) }, scope: undefined, count: t.intervals.length };
  }
  const rows = (await listForecastValues(ctx, { zone_id: zoneId, sub_zone_id: subZoneId, date, limit: 200 })).items;
  const low = new Array<number>(96).fill(0);
  const expected = new Array<number>(96).fill(0);
  const high = new Array<number>(96).fill(0);
  for (const row of rows) {
    low[row.interval_index] = row.low;
    expected[row.interval_index] = row.expected;
    high[row.interval_index] = row.high;
  }
  const scope = { field: rows.reduce((sum, row) => sum + row.field_expected, 0), remote: rows.reduce((sum, row) => sum + row.remote_inferred_expected, 0) };
  return { timeline: { labels, low, expected, high }, scope, count: rows.length };
}

async function splitFor(ctx: RequestContext, zoneId: string, date: string, canPreviewDraft: boolean, wantsDraft: boolean, scope: SubZoneScope | undefined): Promise<SplitView> {
  const active = await getForecastSplit(ctx, { zone_id: zoneId, date });
  const activeZone = active.zones.find((z) => z.zone_id === zoneId);
  const activeShare = activeZone?.field_share ?? 0;

  let activeCount = 0;
  let draftCount = 0;
  let previewRuleCode: string | null = null;
  let previewVersionId: string | undefined;
  if (canPreviewDraft) {
    activeCount = (await listRules(ctx, { status: 'active', limit: 200 })).items.length;
    const draftRules = (await listRules(ctx, { status: 'draft', limit: 200 })).items.sort((a, b) => a.rule_code.localeCompare(b.rule_code));
    draftCount = draftRules.length;
    const firstDraft = draftRules[0];
    if (firstDraft !== undefined) {
      const version = (await listRuleVersions(ctx, firstDraft.rule_code, { limit: 200 })).items.find((v) => v.status === 'draft');
      if (version !== undefined) {
        previewRuleCode = firstDraft.rule_code;
        previewVersionId = version.id;
      }
    }
  }

  const canPreview = canPreviewDraft && previewVersionId !== undefined;
  if (!canPreview || !wantsDraft) {
    if (scope !== undefined) {
      return scopeSplit({ fieldExpected: 0, remoteExpected: 0, fieldShare: 0, ruleSetVersion: active.rule_set_version, canPreviewDraft: canPreview, activeCount, draftCount, previewRuleCode }, scope, null);
    }
    return {
      fieldExpected: Math.round(activeZone?.field_expected ?? 0),
      remoteExpected: Math.round(activeZone?.remote_inferred_expected ?? 0),
      fieldShare: activeShare,
      ruleSetVersion: active.rule_set_version,
      canPreviewDraft: canPreview,
      activeCount,
      draftCount,
      previewRuleCode,
    };
  }

  const draft = await getForecastSplit(ctx, { zone_id: zoneId, date, rule_version_id: previewVersionId });
  const draftZone = draft.zones.find((z) => z.zone_id === zoneId);
  if (scope !== undefined) {
    const base = { fieldExpected: 0, remoteExpected: 0, fieldShare: 0, ruleSetVersion: draft.rule_set_version, canPreviewDraft: true, activeCount: activeCount + 1, draftCount: Math.max(0, draftCount - 1), previewRuleCode };
    return scopeSplit(base, scope, draftZone?.field_share ?? activeShare);
  }
  return {
    fieldExpected: Math.round(draftZone?.field_expected ?? 0),
    remoteExpected: Math.round(draftZone?.remote_inferred_expected ?? 0),
    fieldShare: draftZone?.field_share ?? activeShare,
    ruleSetVersion: draft.rule_set_version,
    canPreviewDraft: true,
    activeCount: activeCount + 1,
    draftCount: Math.max(0, draftCount - 1),
    previewRuleCode,
  };
}

async function heatFor(ctx: RequestContext, zoneId: string, subZoneRows: readonly SubZone[], date: string, time: number, activeSub: string, locale: 'en' | 'ar'): Promise<{ readonly mapZones: FxMapZone[]; readonly top: TopRow[] }> {
  const rows = (await listForecastValues(ctx, { zone_id: zoneId, date, interval_start: intervalStartOf(date, time), limit: 200 })).items;
  const byId = new Map(rows.map((r) => [r.sub_zone_id, r.expected] as const));
  const max = Math.max(0, ...rows.map((r) => r.expected));
  const bucket = (value: number): 1 | 2 | 3 | 4 | 5 => {
    if (max <= 0) return 1;
    const level = Math.ceil((value / max) * 5);
    return Math.min(5, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5;
  };
  const mapZones: FxMapZone[] = subZoneRows.map((s) => {
    const code = extraCode(s, s.id);
    return { code, label: code.slice(-2), lat: s.latitude, lon: s.longitude, radiusKm: SUB_ZONE_RADIUS_KM, heat: bucket(byId.get(s.id) ?? 0), active: code === activeSub };
  });
  const top: TopRow[] = subZoneRows
    .map((s) => ({ code: extraCode(s, s.id), ...localName(s, locale), value: byId.get(s.id) ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((row) => ({ ...row, shareOfMax: max <= 0 ? 0 : row.value / max }));
  return { mapZones, top };
}
