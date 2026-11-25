// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Leave Policy and Calendar screen: reads through lib/data with the request context and returns plain data
//. Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads (platform.records): listHolidays, listHijriMonths (the reference table, 2026 only, 13 months), listPrayerTimes (stored rows
// and the day shown, which the data layer computes when a day is not stored), getLeavePolicy, listCities, getDemoToday. Today is
// the app's own day (`demo.today`, as the Ops screens read it), or the Riyadh day of `now` when a test injects one. Hijri days
// come from the table's month starts and from `Intl` (Umm al-Qura), the same calendar the data layer converts with.

import { gregorianWeeks, hijriWeeks, addDays, type DayContext } from '@/components/opendispatch/month-grid-geometry';
import type { RequestContext } from '@/lib/data/guard';
import { listCities, listZones } from '@/lib/data/locations';
import { getDemoToday } from '@/lib/data/settings';
import { getLeavePolicy, listCalendarEvents, listHijriMonths, listHolidays, listPrayerTimes } from '@/lib/data/time';
import type { CalendarEvent, DataSource, Holiday, HijriMonth, PageInfo, PrayerTime } from '@/lib/types';
import { RANGE_KINDS, type CalendarMode, type EventRow, type EventsView, type HolidayKind, type HolidayRow, type MonthView, type NoticeZone, type PolicyData, type PrayerRow, type RamadanMarker, type RangeKind } from './types';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface CalendarQuery {
  readonly q?: string | undefined;
  readonly type?: HolidayKind | undefined;
  readonly cal?: CalendarMode | undefined;
  /** `YYYY-MM`: a Gregorian month, or a Hijri one (`1447-09`) when `cal` is `hijri`. */
  readonly month?: string | undefined;
  /** The day the Prayer times tab shows, `YYYY-MM-DD`. */
  readonly date?: string | undefined;
  /** `?holiday=`: a holiday id, or `new`. */
  readonly holiday?: string | undefined;
  /** The page language: it decides which name a holiday has on the grid (English when omitted). */
  readonly locale?: 'en' | 'ar' | undefined;
}

export interface CalendarView {
  readonly sources: readonly DataSource[];
  readonly today: string;
  readonly counts: { readonly holidays: number; readonly ramadanDays: number; readonly daysToNationalDay: number | null; readonly cities: number };
  /** Every holiday, and the ones matching the search and type filter. */
  readonly holidays: readonly HolidayRow[];
  readonly shownHolidays: readonly HolidayRow[];
  readonly month: MonthView;
  readonly ramadan: RamadanMarker | null;
  readonly prayer: {
    readonly date: string;
    readonly prev: string;
    readonly next: string;
    readonly rows: readonly PrayerRow[];
    /** The first and last day with stored prayer times, or null when none is stored. */
    readonly storedRange: { readonly from: string; readonly to: string } | null;
  };
  readonly policy: PolicyData;
  /** The holiday `?holiday=` opens; undefined when there is none, it is `new`, or it does not exist. */
  readonly openHoliday: HolidayRow | undefined;
  readonly unknownHoliday: boolean;
  readonly exportHeader: readonly string[];
  readonly exportRows: readonly (readonly string[])[];
}

const PAGE = 200;

async function listAll<T>(fetch: (cursor: string | undefined) => { items: T[]; page: PageInfo } | Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

/** The calendar day in Riyadh, `YYYY-MM-DD`. */
export function riyadhDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
const pad = (n: number): string => String(n).padStart(2, '0');
const hijriKey = (m: HijriMonth): string => `${m.hijri_year}-${pad(m.hijri_month)}`;

function holidayRow(h: Holiday): HolidayRow {
  return { id: h.id, nameEn: h.name_en, nameAr: h.name_ar, kind: h.kind, from: h.start_date, to: h.end_date, days: daysBetween(h.start_date, h.end_date) + 1 };
}

function monthOf(mode: CalendarMode, asked: string | undefined, today: string, months: readonly HijriMonth[], context: DayContext): MonthView {
  if (mode === 'hijri' && months.length > 0) {
    // The month asked for, else the one that holds today, else the first the table has.
    const current = (months.find((m) => hijriKey(m) === asked) ?? months.find((m) => m.gregorian_start <= today && today <= m.gregorian_end) ?? months[0]) as HijriMonth;
    const at = months.indexOf(current);
    return {
      mode,
      key: hijriKey(current),
      prev: at > 0 ? hijriKey(months[at - 1] as HijriMonth) : null,
      next: at < months.length - 1 ? hijriKey(months[at + 1] as HijriMonth) : null,
      weeks: hijriWeeks(current.gregorian_start, current.gregorian_end, context),
      year: current.hijri_year,
      month: current.hijri_month,
      monthNameEn: current.name_en,
      monthNameAr: current.name_ar,
      span: { from: current.gregorian_start, to: current.gregorian_end },
      containsToday: current.gregorian_start <= today && today <= current.gregorian_end,
    };
  }
  const match = asked === undefined ? null : /^(\d{4})-(0[1-9]|1[0-2])$/.exec(asked);
  const year = match === null ? Number(today.slice(0, 4)) : Number(match[1]);
  const month = match === null ? Number(today.slice(5, 7)) : Number(match[2]);
  const previous = month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`;
  const following = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  const first = `${year}-${pad(month)}-01`;
  const last = addDays(month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`, -1);
  return { mode: 'gregorian', key: `${year}-${pad(month)}`, prev: previous, next: following, weeks: gregorianWeeks(year, month, context), year, month, monthNameEn: null, monthNameAr: null, span: { from: first, to: last }, containsToday: first <= today && today <= last };
}

export async function loadCalendarView(ctx: RequestContext, query: CalendarQuery, now?: Date): Promise<CalendarView> {
  const holidays = await listAll((cursor) => listHolidays(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const months = await listAll((cursor) => listHijriMonths(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const cities = await listAll((cursor) => listCities(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const stored = await listAll<PrayerTime>((cursor) => listPrayerTimes(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const policy = await getLeavePolicy(ctx);
  const today = now === undefined ? await getDemoToday(ctx) : riyadhDay(now);

  const rows = holidays.map(holidayRow);
  const ramadans = months.filter((m) => m.is_ramadan);
  // The month of Ramadan is a holiday record too (it fills the holidays table), but on the grid it is the tint, never a name repeated
  // on every day (as the mockup does), so a record that spans exactly a Ramadan month is left out of the day names. A name is the
  // Arabic one on the Arabic page when there is one.
  const ramadanWindows = new Set(ramadans.map((m) => `${m.gregorian_start}|${m.gregorian_end}`));
  const dayNames = rows.filter((h) => !ramadanWindows.has(`${h.from}|${h.to}`)).map((h) => ({ id: h.id, name: query.locale === 'ar' ? (h.nameAr ?? h.nameEn) : h.nameEn, from: h.from, to: h.to }));
  const context: DayContext = { today, ramadan: ramadans.map((m) => ({ from: m.gregorian_start, to: m.gregorian_end })), holidays: dayNames };
  const nationalDay = rows.filter((h) => /national day/i.test(h.nameEn) && h.from >= today).sort((a, b) => a.from.localeCompare(b.from))[0];

  // A day that exists: `2026-02-31` would roll over into March, so it is compared with what it becomes.
  const isDay = (value: string | undefined): value is string => value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  const date = isDay(query.date) ? query.date : today;
  const dayRows = (await listPrayerTimes(ctx, { date_from: date, date_to: date, limit: PAGE })).items;
  const storedKeys = new Set(stored.map((p) => `${p.city_id}|${p.prayer_date}`));
  const cityName = new Map(cities.map((c) => [c.id, c.name_en] as const));
  const prayerRows: PrayerRow[] = dayRows.map((p) => ({ cityId: p.city_id, cityName: cityName.get(p.city_id) ?? '', fajr: p.fajr, sunrise: p.sunrise ?? null, dhuhr: p.dhuhr, asr: p.asr, maghrib: p.maghrib, isha: p.isha, stored: storedKeys.has(`${p.city_id}|${p.prayer_date}`) }));
  const dates = stored.map((p) => p.prayer_date).sort();

  const shown = rows.filter((h) => (query.type === undefined || h.kind === query.type) && (query.q === undefined || query.q.trim() === '' || `${h.nameEn} ${h.nameAr ?? ''}`.toLowerCase().includes(query.q.trim().toLowerCase())));
  const asked = query.holiday !== undefined && query.holiday !== 'new';
  const open = asked ? rows.find((h) => h.id === query.holiday) : undefined;
  const ramadan = ramadans[0];
  const share = Math.round(policy.max_concurrent_leave_share * 100);

  return {
    sources: [...new Set<DataSource>([...holidays, ...months, ...cities, ...stored].map((r) => r.data_source))],
    today,
    counts: { holidays: rows.length, ramadanDays: ramadans.reduce((sum, m) => sum + daysBetween(m.gregorian_start, m.gregorian_end) + 1, 0), daysToNationalDay: nationalDay === undefined ? null : daysBetween(today, nationalDay.from), cities: cities.length },
    holidays: rows,
    shownHolidays: shown,
    month: monthOf(query.cal ?? 'gregorian', query.month, today, months, context),
    ramadan: ramadan === undefined ? null : { hijriYear: ramadan.hijri_year, from: ramadan.gregorian_start, to: ramadan.gregorian_end, gregorianKey: ramadan.gregorian_start.slice(0, 7), hijriKey: hijriKey(ramadan) },
    prayer: { date, prev: addDays(date, -1), next: addDays(date, 1), rows: prayerRows, storedRange: dates.length === 0 ? null : { from: dates[0] as string, to: dates.at(-1) as string } },
    policy: { minNoticeDays: policy.min_notice_days, sharePercent: share, blackouts: policy.blackout_periods.map((b) => ({ from: b.start_date, to: b.end_date, label: b.label_en })) },
    openHoliday: open,
    unknownHoliday: asked && open === undefined,
    exportHeader: ['name_en', 'name_ar', 'kind', 'start_date', 'end_date', 'days'],
    exportRows: shown.map((h) => [h.nameEn, h.nameAr ?? '', h.kind, h.from, h.to, String(h.days)]),
  };
}

function eventRow(e: CalendarEvent, codeOf: ReadonlyMap<string, string>): EventRow {
  const row: EventRow = { id: e.id, kind: e.kind, eventType: e.event_type ?? null, name: e.name, start: e.start_date, end: e.end_date, source: e.source, cities: e.scope.cities, region: e.scope.region ?? null };
  const n = e.notice;
  if (n === undefined) return row;
  const zoneCodes = n.zone_ids.map((id) => codeOf.get(id) ?? id);
  return { ...row, notice: { noticeType: n.notice_type, impact: n.impact, zoneCodes, startTime: n.start_time ?? null, endTime: n.end_time ?? null, quote: n.quote ?? null } };
}

/** The Events tab, from the app's today. */
export async function loadEventsView(ctx: RequestContext, today: string): Promise<EventsView> {
  const read = await listCalendarEvents(ctx, { from: today });
  const cities = new Map((await listCities(ctx, { limit: PAGE })).items.map((c) => [c.id, c.name_en] as const));
  const zones: NoticeZone[] = (await listZones(ctx, { limit: PAGE })).items
    .filter((z) => z.is_active)
    .map((z) => ({ id: z.id, code: typeof z.extra?.['code'] === 'string' ? z.extra['code'] : z.name_en, city: cities.get(z.city_id) ?? '' }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const codeOf = new Map(zones.map((z) => [z.id, z.code] as const));
  const rows = read.items.map((e) => eventRow(e, codeOf));
  const ranges = Object.fromEntries(RANGE_KINDS.map((kind) => [kind, rows.filter((r) => r.kind === kind)])) as Record<RangeKind, EventRow[]>;
  return { paydayDay: read.payday_day, ranges, derived: rows.filter((r) => r.kind === 'derived'), notices: rows.filter((r) => r.kind === 'notice'), zones };
}
