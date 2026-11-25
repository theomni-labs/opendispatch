// SPDX-License-Identifier: AGPL-3.0-only
// Remote Queue view model (server only)

import { addDays } from '@/lib/day';
import { date, dateBoth, num, time } from '@opendispatch/ui/format';
import { getDemoToday } from '@/lib/data/settings';
import { listAllCases, listCases, listCaseTypes } from '@/lib/data/cases';
import { ForbiddenError } from '@/lib/data/errors';
import { listShiftPatterns } from '@/lib/data/time';
import { caseTypeName } from '@/lib/data/wording';
import { listZones } from '@/lib/data/locations';
import type { RequestContext } from '@/lib/data/guard';
import { getRemoteCapacity, getRemoteProductivity, getRemoteQueueClock, getRemoteRoster, getRemoteStaffing, listRemoteQueue } from '@/lib/data/remote';
import { listAgents } from '@/lib/data/people';
import type { Case, DataSource, RemoteQueueItem, RemoteRosterLine, RemoteStaffing, ShiftPattern, Agent, Zone } from '@/lib/types';
import { dayLoad, gapRuns, groupDurations, type CaseTimes, type PlanInterval } from './remote-plan';
import type { QueueTab, WAIT_THRESHOLDS } from './types';

const PAGE = 200;
/** Rows per table page (mockup's own PAGE constant: "1 to 10 of 50"). */
export const TABLE_PAGE_SIZE = 10;

export interface QueueRowView {
  readonly id: string;
  readonly caseNumber: string;
  readonly zoneCode: string;
  readonly caseTypeLabel: string;
  readonly parties: number;
  readonly status: RemoteQueueItem['status'];
  readonly waitMinutes: number | undefined;
  readonly waitLabel: string;
  readonly reviewerName: string | null;
  readonly canAssign: boolean;
  /** A reported case the rules routed here: the deciding rule's name, or null for the default. */
  readonly rule?: { readonly name: string | null } | undefined;
  /** The latest AI suggestion, in brief. */
  readonly ai?: { readonly handling: 'field' | 'remote_inferred'; readonly pct: number } | undefined;
}

export interface CandidateView {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly poolZoneCode: string | null;
}

export interface AssignDrawerTarget {
  readonly caseId: string;
  readonly caseNumber: string;
  readonly zoneCode: string;
  readonly waitLabel: string;
  readonly candidates: readonly CandidateView[];
}

export interface PeakGapView {
  readonly valueLabel: string;
  readonly atLabel: string;
}

export interface StatsView {
  readonly waiting: number;
  readonly inReview: number;
  readonly longestWaitLabel: string;
  readonly peakGap: PeakGapView | null;
}

export interface StaffingView {
  readonly dateLabel: string;
  readonly labels: readonly string[];
  readonly planned: readonly number[];
  readonly required: readonly number[];
}

export interface ZoneOption {
  readonly value: string;
  readonly label: string;
}

export interface QueueCounts {
  readonly waiting: number;
  readonly in_review: number;
  readonly done: number;
}

export interface RemoteQueueView {
  readonly isEmpty: boolean;
  readonly sources: readonly DataSource[];
  readonly queueDateLabel: string | null;
  readonly asOfTimeLabel: string | null;
  readonly stats: StatsView;
  readonly staffing: StaffingView;
  readonly zoneOptions: readonly ZoneOption[];
  readonly counts: QueueCounts;
  readonly rows: readonly QueueRowView[];
  readonly firstWaitingCaseId: string | null;
  readonly drawer: AssignDrawerTarget | undefined;
}

export interface RemoteQueueQuery {
  readonly tab?: QueueTab | undefined;
  readonly q?: string | undefined;
  readonly zone?: string | undefined;
  readonly wait?: (typeof WAIT_THRESHOLDS)[number] | undefined;
  readonly assign?: string | undefined;
}


function zoneCode(zone: Zone): string {
  return typeof zone.extra?.['code'] === 'string' ? zone.extra['code'] : zone.id;
}

/** The deciding rule's name in the page's language; null for the default outcome. */
function ruleName(cls: NonNullable<RemoteQueueItem['classification']>, locale: 'en' | 'ar'): string | null {
  if (cls.rule_code === null) return null;
  const ar = cls.rule_name_ar ?? null;
  return locale === 'ar' && ar !== null && ar.trim() !== '' ? ar : (cls.rule_name_en ?? cls.rule_code);
}

function localizedName(record: { readonly name_en: string; readonly name_ar?: string | null | undefined }, locale: 'en' | 'ar'): string {
  return locale === 'ar' && record.name_ar !== null && record.name_ar !== undefined && record.name_ar.trim() !== '' ? record.name_ar : record.name_en;
}

/** Minutes between two instants, floored at 0 (a clock skew or a same-tick pair never goes negative). */
function minutesBetween(fromIso: string, toMs: number): number {
  return Math.max(0, Math.round((toMs - Date.parse(fromIso)) / 60_000));
}

export async function loadRemoteQueueView(ctx: RequestContext, query: RemoteQueueQuery, locale: 'en' | 'ar'): Promise<RemoteQueueView> {
  const zones = (await listZones(ctx, { limit: PAGE })).items;
  const zoneCodeById = new Map(zones.map((z) => [z.id, zoneCode(z)] as const));
  const zoneOptions: ZoneOption[] = zones.map((z) => ({ value: zoneCode(z), label: zoneCode(z) })).sort((a, b) => a.value.localeCompare(b.value));

  const items = (await listRemoteQueue(ctx, { limit: PAGE })).items;
  const clock = await getRemoteQueueClock(ctx);
  const staffDate = addDays(await getDemoToday(ctx), 1);
  const staffing = await getRemoteStaffing(ctx, { date: staffDate });

  const staffingView: StaffingView = {
    dateLabel: date(staffDate, { locale }),
    labels: staffing.intervals.map((i) => time(i.interval_start)),
    planned: staffing.intervals.map((i) => i.planned_reviewers),
    required: staffing.intervals.map((i) => i.required_reviewers),
  };
  const peakInterval = staffing.intervals.reduce<(typeof staffing.intervals)[number] | undefined>(
    (min, cur) => (min === undefined || cur.delta < min.delta ? cur : min),
    undefined,
  );
  const peakGap: PeakGapView | null = peakInterval === undefined ? null : { valueLabel: num(peakInterval.delta, 1, locale), atLabel: time(peakInterval.interval_start) };

  if (items.length === 0) {
    return {
      isEmpty: true,
      sources: ['SYNTHETIC'],
      queueDateLabel: null,
      asOfTimeLabel: null,
      stats: { waiting: 0, inReview: 0, longestWaitLabel: '0:00', peakGap },
      staffing: staffingView,
      zoneOptions,
      counts: { waiting: 0, in_review: 0, done: 0 },
      rows: [],
      firstWaitingCaseId: null,
      drawer: undefined,
    };
  }

  // the queue's own day; live cases have the board's
  const day = (items.find((i) => i.classification === undefined) ?? (items[0] as RemoteQueueItem)).registered_at.slice(0, 10);
  const asOfMs = clock === null ? Date.parse(`${day}T23:59:59+03:00`) : Date.parse(clock.as_of);
  const liveAsOfMs = clock?.live_as_of === undefined ? asOfMs : Date.parse(clock.live_as_of);

  const caseIds = new Set(items.map((i) => i.case_id));
  // by id: a day can hold more than one page
  const cases = (await listCases(ctx, { ids: [...caseIds], limit: PAGE })).items;
  const caseById = new Map(cases.map((c) => [c.id, c] as const));
  const caseTypeNameById = new Map((await listCaseTypes(ctx, { limit: PAGE })).items.map((t) => [t.id, t.name_en] as const));

  const agents = (await listAgents(ctx, { limit: PAGE })).items;
  const agentById = new Map(agents.map((s) => [s.id, s] as const));
  const remotePool = agents.filter(
    (s) => s.kind === 'remote' && s.is_active && s.id !== ctx.userId && s.extra?.['user_id'] !== ctx.userId,
  );

  function caseTypeLabel(c: Case | undefined): string {
    // the data model spelling: fixed data, translate="no".
    if (c === undefined) return '—';
    const name = caseTypeNameById.get(c.case_type_id);
    return name === undefined ? '—' : caseTypeName(name, locale);
  }

  const counts: Record<RemoteQueueItem['status'], number> = { waiting: 0, in_review: 0, done: 0 };
  const rows: QueueRowView[] = items.map((item) => {
    counts[item.status] += 1;
    const kase = caseById.get(item.case_id);
    const startMs = item.status === 'waiting' ? (item.classification === undefined ? asOfMs : liveAsOfMs) : item.review_started_at !== null && item.review_started_at !== undefined ? Date.parse(item.review_started_at) : undefined;
    const waitMinutes = startMs === undefined ? undefined : minutesBetween(item.registered_at, startMs);
    return {
      id: item.case_id,
      caseNumber: item.case_number,
      zoneCode: zoneCodeById.get(item.zone_id) ?? '—',
      caseTypeLabel: caseTypeLabel(kase),
      parties: kase?.parties_involved ?? 0,
      status: item.status,
      waitMinutes,
      waitLabel: waitMinutes === undefined ? '—' : time(waitMinutes),
      reviewerName:
        item.assigned_reviewer_id === null || item.assigned_reviewer_id === undefined
          ? null
          : (agentById.get(item.assigned_reviewer_id) !== undefined ? localizedName(agentById.get(item.assigned_reviewer_id) as Agent, locale) : item.assigned_reviewer_id),
      canAssign: item.status === 'waiting',
      rule: item.classification === undefined ? undefined : { name: ruleName(item.classification, locale) },
      ai: item.ai_suggestion === undefined ? undefined : { handling: item.ai_suggestion.handling, pct: Math.round(item.ai_suggestion.confidence * 100) },
    };
  });

  const tab = query.tab ?? 'waiting';
  const waitFloor = query.wait === undefined ? 0 : Number(query.wait);
  const needle = query.q?.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      r.status === tab &&
      (query.zone === undefined || r.zoneCode === query.zone) &&
      (r.waitMinutes ?? 0) >= waitFloor &&
      (needle === undefined || needle === '' || r.caseNumber.toLowerCase().includes(needle)),
  );

  const firstWaiting = rows.find((r) => r.status === 'waiting');
  const waitingTarget = query.assign === undefined ? undefined : rows.find((r) => r.id === query.assign && r.status === 'waiting');
  const drawer: AssignDrawerTarget | undefined =
    waitingTarget === undefined
      ? undefined
      : {
          caseId: waitingTarget.id,
          caseNumber: waitingTarget.caseNumber,
          zoneCode: waitingTarget.zoneCode,
          waitLabel: waitingTarget.waitLabel,
          candidates: remotePool
            .filter((s) => s.id !== caseById.get(waitingTarget.id)?.agent_id)
            .map((s) => ({ id: s.id, name: localizedName(s, locale), code: s.code, poolZoneCode: typeof s.extra?.['pool_zone_code'] === 'string' ? s.extra['pool_zone_code'] : null }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        };

  const longestWaitMinutes = Math.max(0, ...rows.filter((r) => r.status === 'waiting').map((r) => r.waitMinutes ?? 0));

  const sources = [...new Set<DataSource>([...items.map((i) => i.data_source), ...cases.map((c) => c.data_source), staffing.data_source])];

  return {
    isEmpty: false,
    sources,
    queueDateLabel: dateBoth(day, { locale }),
    asOfTimeLabel: clock === null ? null : time(clock.as_of),
    stats: { waiting: counts.waiting, inReview: counts.in_review, longestWaitLabel: time(longestWaitMinutes), peakGap },
    staffing: staffingView,
    zoneOptions,
    counts,
    rows: filtered,
    firstWaitingCaseId: firstWaiting?.id ?? null,
    drawer,
  };
}

// ---------------------------------------------------------------------------------------------
// Roster tab: getRemoteRoster and getRemoteCapacity
// ---------------------------------------------------------------------------------------------

const WEEK_DAYS = 7;

export interface RosterLineView {
  readonly id: string;
  readonly name: string;
  readonly pool: string | null;
  readonly shiftName: string;
  readonly onLeave: boolean;
  readonly from: number;
  readonly to: number;
  readonly breakFrom: number | null;
  readonly breakTo: number | null;
}

export interface ShiftRowView {
  readonly id: string;
  /** null: hours no remote shift covers */
  readonly name: string | null;
  readonly hoursLabel: string;
  readonly scheduled: number;
  readonly demandLabel: string;
  readonly capacityLabel: string;
  readonly utilizationLabel: string;
  readonly gapLabel: string;
  readonly isGap: boolean;
}

export interface WeekRowView {
  readonly date: string;
  readonly dateLabel: string;
  readonly demandLabel: string;
  readonly capacityLabel: string;
  readonly gapLabel: string;
  readonly isGap: boolean;
  readonly noCapacity: boolean;
  readonly worst: { readonly valueLabel: string; readonly atLabel: string } | null;
}

export interface RemoteRosterView {
  readonly date: string;
  readonly dateLabel: string;
  readonly prevDate: string;
  readonly nextDate: string;
  readonly sources: readonly DataSource[];
  /** Where the day's lines come from */
  readonly lineSource: 'roster' | 'home_shifts' | 'none';
  readonly fte: number;
  readonly onShift: number;
  readonly demandLabel: string;
  readonly utilizationLabel: string | null;
  readonly gapLabel: string;
  readonly shifts: readonly ShiftRowView[];
  readonly week: readonly WeekRowView[];
  readonly weekTotal: { readonly demandLabel: string; readonly capacityLabel: string; readonly gapLabel: string; readonly isGap: boolean };
  readonly lines: readonly RosterLineView[];
  readonly gaps: readonly { readonly from: number; readonly to: number; readonly shortLabel: string }[];
  readonly gapIntervals: number;
  readonly poolOptions: readonly ZoneOption[];
}

function signed(value: number, locale: 'en' | 'ar'): string {
  const text = num(value, 1, locale);
  return value > 0.05 ? `+${text}` : text;
}

function formatShare(share: number | null | undefined, locale: 'en' | 'ar'): string {
  return share === null || share === undefined ? '—' : `${num(share * 100, 0, locale)}%`;
}

function hoursOf(iso: string, dayStartMs: number): number {
  return (Date.parse(iso) - dayStartMs) / 3_600_000;
}

function planIntervals(staffing: Pick<RemoteStaffing, 'intervals'>): PlanInterval[] {
  return staffing.intervals.map((i) => ({ index: i.interval_index, required: i.required_reviewers, planned: i.planned_reviewers }));
}

async function shiftPatternsOrEmpty(ctx: RequestContext): Promise<ShiftPattern[]> {
  try {
    return (await listShiftPatterns(ctx, { limit: PAGE })).items;
  } catch (err) {
    if (err instanceof ForbiddenError) return [];
    throw err;
  }
}

function lineView(l: RemoteRosterLine, dayStartMs: number, locale: 'en' | 'ar', shiftName: (code: string | null) => string): RosterLineView {
  const at = (iso: string | null | undefined) => (iso === null || iso === undefined ? null : hoursOf(iso, dayStartMs));
  return {
    id: l.agent_id,
    name: localizedName(l, locale),
    pool: l.pool_zone_code ?? null,
    shiftName: shiftName(l.shift_code ?? null),
    onLeave: l.on_leave,
    from: hoursOf(l.start_at, dayStartMs),
    to: hoursOf(l.end_at, dayStartMs),
    breakFrom: at(l.break_start_at),
    breakTo: at(l.break_end_at),
  };
}

export async function loadRemoteRosterView(ctx: RequestContext, query: { readonly date?: string | undefined; readonly pool?: string | undefined }, locale: 'en' | 'ar'): Promise<RemoteRosterView> {
  const day = query.date ?? addDays(await getDemoToday(ctx), 1);
  const dayStartMs = Date.parse(`${day}T00:00:00+03:00`);
  const [roster, capacity, staffingDays, patterns] = await Promise.all([
    getRemoteRoster(ctx, { date: day }),
    getRemoteCapacity(ctx, { date_from: day, date_to: addDays(day, WEEK_DAYS - 1) }),
    // the worst interval: capacity has none
    Promise.all(Array.from({ length: WEEK_DAYS }, (_, i) => getRemoteStaffing(ctx, { date: addDays(day, i) }))),
    shiftPatternsOrEmpty(ctx),
  ]);
  const byCode = new Map(patterns.map((p) => [p.code, p] as const));
  const shiftName = (code: string | null): string => {
    if (code === null) return '—';
    const p = byCode.get(code);
    return p === undefined ? code : localizedName(p, locale);
  };

  const lines = roster.lines.map((l) => lineView(l, dayStartMs, locale, shiftName));
  const intervals = planIntervals(roster);
  const shiftRows: ShiftRowView[] = roster.day.shifts.map((r) => {
    const code = r.shift_code ?? null;
    const from = r.start_at ?? null;
    const to = r.end_at ?? null;
    return {
      id: code ?? 'outside',
      name: code === null ? null : shiftName(code),
      hoursLabel: from === null || to === null ? '' : `${time(from)} - ${time(to)}`,
      scheduled: r.scheduled,
      demandLabel: num(r.demand_hours, 1, locale),
      capacityLabel: num(r.capacity_hours, 1, locale),
      utilizationLabel: formatShare(r.utilization, locale),
      gapLabel: signed(r.gap_hours, locale),
      isGap: r.gap_hours < -0.05,
    };
  });

  const staffingByDate = new Map(staffingDays.map((s) => [s.date, s] as const));
  const week: WeekRowView[] = capacity.days.map((d) => {
    const s = staffingByDate.get(d.date);
    const worst = s === undefined ? null : dayLoad(planIntervals(s)).worst;
    const at = worst === null ? undefined : s?.intervals.find((i) => i.interval_index === worst.index);
    const noCapacity = d.source === 'none' || d.capacity_hours === 0;
    return {
      date: d.date,
      dateLabel: date(d.date, { locale }),
      demandLabel: num(d.demand_hours, 1, locale),
      capacityLabel: num(d.capacity_hours, 1, locale),
      gapLabel: signed(d.gap_hours, locale),
      isGap: d.gap_hours < -0.05,
      noCapacity,
      worst: worst === null || at === undefined || noCapacity ? null : { valueLabel: num(worst.delta, 1, locale), atLabel: time(at.interval_start) },
    };
  });
  const total = capacity.weeks[0];
  const totalGap = total?.gap_hours ?? 0;

  const pools = [...new Set(lines.map((l) => l.pool).filter((p): p is string => p !== null))].sort();
  const utilization = roster.day.utilization ?? null;
  return {
    date: day,
    dateLabel: date(day, { locale }),
    prevDate: addDays(day, -1),
    nextDate: addDays(day, 1),
    sources: [...new Set<DataSource>([roster.data_source, capacity.data_source, ...staffingDays.map((s) => s.data_source)])],
    lineSource: roster.day.source,
    fte: roster.fte,
    onShift: roster.day.scheduled,
    demandLabel: num(roster.day.demand_hours, 0, locale),
    utilizationLabel: utilization === null ? null : formatShare(utilization, locale),
    gapLabel: signed(roster.day.gap_hours, locale),
    shifts: shiftRows,
    week,
    weekTotal: {
      demandLabel: num(total?.demand_hours ?? 0, 1, locale),
      capacityLabel: num(total?.capacity_hours ?? 0, 1, locale),
      gapLabel: signed(totalGap, locale),
      isGap: totalGap < -0.05,
    },
    lines: lines.filter((l) => query.pool === undefined || l.pool === query.pool),
    gaps: gapRuns(intervals).map((r) => ({ from: r.from, to: r.to, shortLabel: num(r.short, 1, locale) })),
    gapIntervals: intervals.filter((i) => i.planned < i.required).length,
    poolOptions: pools.map((p) => ({ value: p, label: p })),
  };
}

// ---------------------------------------------------------------------------------------------
// Performance tab: getRemoteProductivity, the last 7 days
// ---------------------------------------------------------------------------------------------

export interface CaseTypeRowView {
  readonly id: string;
  readonly label: string;
  readonly cases: number;
  readonly meanLabel: string;
  readonly medianLabel: string;
  readonly receiptToCloseLabel: string;
}

export interface ReviewerRowView {
  readonly id: string;
  readonly name: string;
  readonly cases: number;
  readonly medianLabel: string;
  readonly receiptToCloseLabel: string;
}

export interface RemotePerformanceView {
  readonly isEmpty: boolean;
  readonly sources: readonly DataSource[];
  readonly periodLabel: string;
  readonly handled: number;
  readonly waitLabel: string;
  readonly completeLabel: string;
  /** null: no available hours in the period */
  readonly utilizationLabel: string | null;
  readonly hours: { readonly labels: readonly string[]; readonly received: readonly number[]; readonly handled: readonly number[] };
  readonly caseTypes: readonly CaseTypeRowView[];
  readonly reviewers: readonly ReviewerRowView[];
}

/** "5:42" from seconds */
export function hoursMinutes(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function minutesLabel(seconds: number | null | undefined, locale: 'en' | 'ar'): string {
  return seconds === null || seconds === undefined ? '—' : num(seconds / 60, 1, locale);
}

/** Per day, one decimal. */
function perDay(n: number, days: number): number {
  return Math.round((n / Math.max(1, days)) * 10) / 10;
}

export async function loadRemotePerformanceView(ctx: RequestContext, locale: 'en' | 'ar'): Promise<RemotePerformanceView> {
  const clock = await getRemoteQueueClock(ctx);
  const to = clock?.date ?? addDays(await getDemoToday(ctx), -1);
  const from = addDays(to, -(WEEK_DAYS - 1));
  const prod = await getRemoteProductivity(ctx, { date_from: from, date_to: to });
  const typeNames = new Map((await listCaseTypes(ctx, { limit: PAGE })).items.map((t) => [t.id, t.name_en] as const));

  // stopgap: case_types has no receipt to close
  const cases = prod.overall.cases === 0 ? [] : await listAllCases(ctx, { handling: 'remote_inferred', date_from: from, date_to: to });
  const times: CaseTimes[] = cases.map((c) => ({ registeredAt: c.registered_at, reviewAt: c.remote_review_at ?? null, closedAt: c.closed_at ?? null, caseTypeId: c.case_type_id }));
  const r2cByType = new Map(groupDurations(times, (c) => c.caseTypeId).map((g) => [g.key, g.durations.receiptToCloseSeconds] as const));

  const caseTypes: CaseTypeRowView[] = prod.case_types.map((g) => {
    const id = g.case_type_id ?? null;
    const name = id === null ? undefined : typeNames.get(id);
    const mean = g.mean_complete_minutes ?? null;
    return {
      id: id ?? 'none',
      label: name === undefined ? '—' : caseTypeName(name, locale),
      cases: g.cases,
      meanLabel: mean === null ? '—' : num(mean, 1, locale),
      medianLabel: minutesLabel(g.median_complete_seconds, locale),
      receiptToCloseLabel: hoursMinutes(id === null ? null : r2cByType.get(id)),
    };
  });

  const names =
    prod.reviewers.length === 0 ? new Map<string, string>() : new Map((await listAgents(ctx, { kind: 'remote', limit: PAGE })).items.map((s) => [s.id, localizedName(s, locale)] as const));
  const reviewers: ReviewerRowView[] = prod.reviewers.map((r) => ({
    id: r.agent_id,
    name: names.get(r.agent_id) ?? r.agent_id,
    cases: r.durations.cases,
    medianLabel: minutesLabel(r.durations.median_complete_seconds, locale),
    receiptToCloseLabel: hoursMinutes(r.durations.median_receipt_to_close_seconds),
  }));

  const byHour = new Map(prod.hours.map((h) => [h.hour, h] as const));
  const complete = prod.overall.median_complete_seconds ?? null;
  const utilization = prod.utilization ?? null;
  return {
    isEmpty: prod.overall.cases === 0,
    sources: prod.data_sources.length === 0 ? ['SYNTHETIC'] : [...new Set<DataSource>([...prod.data_sources, ...cases.map((c) => c.data_source)])],
    periodLabel: `${date(from, { locale })} - ${date(to, { locale })}`,
    handled: prod.handled,
    waitLabel: hoursMinutes(prod.overall.median_wait_seconds),
    completeLabel: complete === null ? '—' : num(complete / 60, 0, locale),
    utilizationLabel: utilization === null ? null : formatShare(utilization, locale),
    hours: {
      labels: Array.from({ length: 24 }, (_, h) => time(h * 60)),
      received: Array.from({ length: 24 }, (_, h) => perDay(byHour.get(h)?.received ?? 0, WEEK_DAYS)),
      handled: Array.from({ length: 24 }, (_, h) => perDay(byHour.get(h)?.handled ?? 0, WEEK_DAYS)),
    },
    caseTypes,
    reviewers,
  };
}
