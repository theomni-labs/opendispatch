// SPDX-License-Identifier: AGPL-3.0-only
// Leave Planner view model (server only)

import { addDays } from '@/lib/day';
import { checkApproval } from '@/lib/access';
import { getLeaveCoverageEffects, listLeaveRequests, listLeaveWindows } from '@/lib/data/leave';
import { listZones } from '@/lib/data/locations';
import { listAgents } from '@/lib/data/people';
import { listHolidays } from '@/lib/data/time';
import type { RequestContext } from '@/lib/data/guard';
import { date } from '@opendispatch/ui/format';
import type { DataSource, Holiday, LeaveCoverageEffect, LeaveRequest, LeaveWindow, PageInfo, Agent, Zone } from '@/lib/types';
import { noteOf, REMOTE_ZONE_VALUE, type LeaveStatus, type LeaveTypeValue } from './types';

const PAGE = 200;
/** Rows per page, matching the mockup. */
export const TABLE_PAGE_SIZE = 10;

/** Every page: roster runs to 330 rows. */
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

export interface ZoneOption {
  readonly value: string;
  readonly label: string;
}

export interface EffectView {
  readonly chip: 'remote' | 'none' | 'gaps' | 'ok';
  readonly newGapIntervals: number;
  readonly daysAffected: number;
  readonly requiredByDay: readonly number[];
  readonly plannedByDay: readonly number[];
  readonly dayLabels: readonly string[];
}

export interface RequestRowView {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly kind: Agent['kind'];
  readonly zoneCode: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly startLabel: string;
  readonly endLabel: string;
  readonly days: number;
  readonly leaveType: LeaveTypeValue;
  readonly status: LeaveStatus;
  readonly requestedLabel: string;
  readonly decidedLabel: string | null;
  /** Decision note, else the request's own. */
  readonly note: string | null;
  readonly own: boolean;
  readonly canDecide: boolean;
  readonly effect: EffectView;
}

export interface CandidateView {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly zoneCode: string;
}

export interface CalendarDay {
  readonly date: string;
  readonly dayOfMonth: number;
  readonly isHoliday: boolean;
  readonly holidayName: string | null;
  readonly demandPercent: number;
}

export interface CalendarZoneDay {
  readonly approved: number;
  readonly requested: number;
  readonly recommended: boolean;
}

export interface CalendarZoneRow {
  readonly zoneCode: string;
  readonly zoneName: string;
  readonly days: readonly CalendarZoneDay[];
}

export interface CalendarWeekHeader {
  readonly label: string;
}

export interface LeaveWindowsView {
  readonly weekHeaders: readonly CalendarWeekHeader[];
  readonly days: readonly CalendarDay[];
  readonly zones: readonly CalendarZoneRow[];
  /** Every zone-week marked recommended, in range. */
  readonly recommendedCount: number;
}

export interface StatsView {
  readonly pending: number;
  readonly approved: number;
  readonly newGapsIfApproved: number;
  readonly recommendedWindows: number;
}

export interface LeavePlannerView {
  readonly isEmpty: boolean;
  readonly sources: readonly DataSource[];
  readonly stats: StatsView;
  readonly counts: Readonly<Record<LeaveStatus, number>>;
  readonly rows: readonly RequestRowView[];
  readonly zoneOptions: readonly ZoneOption[];
  readonly candidates: readonly CandidateView[];
  readonly windows: LeaveWindowsView;
  readonly drawer: RequestRowView | undefined;
}

export interface LeavePlannerQuery {
  readonly tab?: LeaveStatus | undefined;
  readonly zone?: string | undefined;
  readonly type?: LeaveTypeValue | undefined;
  readonly q?: string | undefined;
  readonly id?: string | undefined;
}

function zoneCode(zone: Zone): string {
  return typeof zone.extra?.['code'] === 'string' ? zone.extra['code'] : zone.id;
}

function localizedName(record: { readonly name_en: string; readonly name_ar?: string | null | undefined }, locale: 'en' | 'ar'): string {
  return locale === 'ar' && record.name_ar !== null && record.name_ar !== undefined && record.name_ar.trim() !== '' ? record.name_ar : record.name_en;
}


function daysBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, n) => s + n, 0) / values.length;
}

/** One point per day leave changed. */
function effectViewFrom(effect: LeaveCoverageEffect, kind: Agent['kind']): EffectView {
  const byDay = new Map<string, { required: number[]; planned: number[] }>();
  for (const cell of effect.cells) {
    const day = cell.interval_start.slice(0, 10);
    const bucket = byDay.get(day) ?? { required: [], planned: [] };
    bucket.required.push(cell.required);
    bucket.planned.push(cell.planned_after);
    byDay.set(day, bucket);
  }
  const days = [...byDay.keys()].sort();
  const chip: EffectView['chip'] = kind === 'remote' ? 'remote' : days.length === 0 ? 'none' : effect.new_gap_intervals > 0 ? 'gaps' : 'ok';
  return {
    chip,
    newGapIntervals: effect.new_gap_intervals,
    daysAffected: days.length,
    requiredByDay: days.map((d) => Math.round(mean((byDay.get(d) as { required: number[] }).required) * 10) / 10),
    plannedByDay: days.map((d) => Math.round(mean((byDay.get(d) as { planned: number[] }).planned) * 10) / 10),
    dayLabels: days.map((d) => String(Number(d.slice(8, 10)))),
  };
}

function emptyWindows(): LeaveWindowsView {
  return { weekHeaders: [], days: [], zones: [], recommendedCount: 0 };
}

/** 4-week, per-zone: real windows, counts, holidays. */
async function loadWindows(ctx: RequestContext, zones: readonly Zone[], zoneCodeById: ReadonlyMap<string, string>, allRows: readonly RequestRowView[], locale: 'en' | 'ar'): Promise<LeaveWindowsView> {
  const windowItems = (await listLeaveWindows(ctx, { limit: PAGE })).items;
  if (windowItems.length === 0) return emptyWindows();

  const byZone = new Map<string, LeaveWindow[]>();
  for (const w of windowItems) byZone.set(w.zone_id, [...(byZone.get(w.zone_id) ?? []), w]);
  const canonical = [...byZone.values()][0] ?? [];
  const weeks = canonical.map((w) => ({ start: w.start_date, end: w.end_date })).sort((a, b) => a.start.localeCompare(b.start));
  const firstWeek = weeks[0];
  const lastWeek = weeks[weeks.length - 1];
  if (firstWeek === undefined || lastWeek === undefined) return emptyWindows();
  const rangeStart = firstWeek.start;
  const rangeEnd = lastWeek.end;

  const holidays = (await listHolidays(ctx, { date_from: rangeStart, date_to: rangeEnd, limit: PAGE })).items;
  const holidayByDate = new Map<string, Holiday>();
  for (const h of holidays) for (let d = h.start_date; d <= h.end_date; d = addDays(d, 1)) holidayByDate.set(d, h);

  const allDates: string[] = [];
  for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) allDates.push(d);
  const weekOf = (d: string) => weeks.find((w) => d >= w.start && d <= w.end);

  const demandByWeekStart = new Map<string, number[]>();
  for (const w of windowItems) demandByWeekStart.set(w.start_date, [...(demandByWeekStart.get(w.start_date) ?? []), w.demand_index]);
  const weekDemand = new Map<string, number>();
  for (const [start, values] of demandByWeekStart) weekDemand.set(start, mean(values));
  const demandValues = [...weekDemand.values()];
  const demandMin = demandValues.length === 0 ? 0 : Math.min(...demandValues);
  const demandMax = demandValues.length === 0 ? 1 : Math.max(...demandValues);
  const demandSpan = demandMax - demandMin || 1;

  const days: CalendarDay[] = allDates.map((d) => {
    const week = weekOf(d);
    const value = week === undefined ? demandMin : (weekDemand.get(week.start) ?? demandMin);
    const holiday = holidayByDate.get(d);
    return {
      date: d,
      dayOfMonth: Number(d.slice(8, 10)),
      isHoliday: holiday !== undefined,
      holidayName: holiday === undefined ? null : localizedName(holiday, locale),
      demandPercent: Math.max(8, Math.round(((value - demandMin) / demandSpan) * 100)),
    };
  });

  const perZoneDay = new Map<string, Map<string, { approved: number; requested: number }>>();
  for (const row of allRows) {
    if (row.zoneCode === null || (row.status !== 'approved' && row.status !== 'requested')) continue;
    const zoneMap = perZoneDay.get(row.zoneCode) ?? new Map<string, { approved: number; requested: number }>();
    perZoneDay.set(row.zoneCode, zoneMap);
    for (let d = row.startDate; d <= row.endDate; d = addDays(d, 1)) {
      if (d < rangeStart || d > rangeEnd) continue;
      const cell = zoneMap.get(d) ?? { approved: 0, requested: 0 };
      if (row.status === 'approved') cell.approved += 1;
      else cell.requested += 1;
      zoneMap.set(d, cell);
    }
  }

  const zoneRows: CalendarZoneRow[] = zones
    .filter((z) => byZone.has(z.id))
    .sort((a, b) => a.name_en.localeCompare(b.name_en))
    .map((z) => {
      const code = zoneCodeById.get(z.id) ?? z.id;
      const zoneWindows = byZone.get(z.id) ?? [];
      const dayCells: CalendarZoneDay[] = allDates.map((d) => {
        const week = weekOf(d);
        const recommended = week === undefined ? false : (zoneWindows.find((w) => w.start_date === week.start)?.recommended ?? false);
        const cell = perZoneDay.get(code)?.get(d);
        return { approved: cell?.approved ?? 0, requested: cell?.requested ?? 0, recommended };
      });
      return { zoneCode: code, zoneName: localizedName(z, locale), days: dayCells };
    });

  return {
    weekHeaders: weeks.map((w) => ({ label: date(w.start, { locale }) })),
    days,
    zones: zoneRows,
    recommendedCount: windowItems.filter((w) => w.recommended).length,
  };
}

export async function loadLeavePlannerView(ctx: RequestContext, query: LeavePlannerQuery, locale: 'en' | 'ar'): Promise<LeavePlannerView> {
  const zones = (await listZones(ctx, { limit: PAGE })).items;
  const zoneCodeById = new Map(zones.map((z) => [z.id, zoneCode(z)] as const));
  const zoneOptions: ZoneOption[] = zones.map((z) => ({ value: zoneCode(z), label: zoneCode(z) })).sort((a, b) => a.value.localeCompare(b.value));

  const agents = await everyPage((cursor) => listAgents(ctx, { limit: PAGE, cursor }));
  const agentById = new Map(agents.map((s) => [s.id, s] as const));
  const candidates: CandidateView[] = agents
    .filter((s) => s.kind === 'field' && s.is_active && s.home_zone_id !== null)
    .map((s) => ({ id: s.id, name: localizedName(s, locale), code: s.code, zoneCode: zoneCodeById.get(s.home_zone_id as string) ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const requests = (await listLeaveRequests(ctx, { limit: PAGE })).items;
  if (requests.length === 0) {
    return {
      isEmpty: true,
      sources: ['SYNTHETIC'],
      stats: { pending: 0, approved: 0, newGapsIfApproved: 0, recommendedWindows: 0 },
      counts: { requested: 0, approved: 0, declined: 0 },
      rows: [],
      zoneOptions,
      candidates,
      windows: emptyWindows(),
      drawer: undefined,
    };
  }

  const effects = await getLeaveCoverageEffects(ctx, requests.map((r) => r.id));
  const effectByRequestId = new Map(effects.map((e) => [e.leave_request_id, e]));

  const rowOf = (request: LeaveRequest): RequestRowView | undefined => {
    const agent = agentById.get(request.agent_id);
    const effect = effectByRequestId.get(request.id);
    if (agent === undefined || effect === undefined) return undefined;
    const check = checkApproval({ role: ctx.role, requesterUserId: request.created_by ?? `agent:${request.agent_id}`, approverUserId: ctx.userId, kind: 'leave', installMode: ctx.installMode });
    const own = !check.allowed && check.reason === 'own_request';
    return {
      id: request.id,
      name: localizedName(agent, locale),
      code: agent.code,
      kind: agent.kind,
      zoneCode: agent.home_zone_id === null ? null : (zoneCodeById.get(agent.home_zone_id) ?? null),
      startDate: request.start_date,
      endDate: request.end_date,
      startLabel: date(request.start_date, { locale }),
      endLabel: date(request.end_date, { locale }),
      days: daysBetween(request.start_date, request.end_date),
      leaveType: request.leave_type,
      status: request.status,
      requestedLabel: date(request.requested_at.slice(0, 10), { locale }),
      decidedLabel: request.decided_at === null || request.decided_at === undefined ? null : date(request.decided_at.slice(0, 10), { locale }),
      note: noteOf(request),
      own,
      canDecide: request.status === 'requested' && check.allowed,
      effect: effectViewFrom(effect, agent.kind),
    };
  };

  const allRows = requests.map(rowOf).filter((r): r is RequestRowView => r !== undefined);

  const counts: Record<LeaveStatus, number> = { requested: 0, approved: 0, declined: 0 };
  for (const r of allRows) counts[r.status] += 1;
  const newGapsIfApproved = allRows.filter((r) => r.status === 'requested').reduce((s, r) => s + r.effect.newGapIntervals, 0);

  const windows = await loadWindows(ctx, zones, zoneCodeById, allRows, locale);

  const tab = query.tab ?? 'requested';
  const needle = query.q?.trim().toLowerCase();
  const filtered = allRows
    .filter(
      (r) =>
        r.status === tab &&
        (query.zone === undefined || (query.zone === REMOTE_ZONE_VALUE ? r.zoneCode === null : r.zoneCode === query.zone)) &&
        (query.type === undefined || r.leaveType === query.type) &&
        (needle === undefined || needle === '' || r.name.toLowerCase().includes(needle) || r.code.toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));

  const sources = [...new Set<DataSource>(requests.map((r) => r.data_source))];
  const drawer = query.id === undefined ? undefined : allRows.find((r) => r.id === query.id);

  return {
    isEmpty: false,
    sources,
    stats: { pending: counts.requested, approved: counts.approved, newGapsIfApproved, recommendedWindows: windows.recommendedCount },
    counts,
    rows: filtered,
    zoneOptions,
    candidates,
    windows,
    drawer,
  };
}
