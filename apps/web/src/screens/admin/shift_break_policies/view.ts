// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Shift and Break Policies screen: reads through lib/data with the request context and returns plain data
//. Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads (platform.records): listShiftPatterns, listBreakRules, listHijriMonths (the Ramadan window). The demo day is the calendar
// day in Riyadh (`now`, injected by tests): the data layer has no operation that reads the `demo.today` setting, so "Hours today"
// and the week strip start from the real date. The next Ramadan is worked out with the Umm al-Qura calendar (`Intl`), because the
// reference table covers 2026 only.

import type { RequestContext } from '@/lib/data/guard';
import { getSettingsSnapshot } from '@/lib/data/settings';
import { listBreakRules, listHijriMonths, listShiftPatterns } from '@/lib/data/time';
import type { BreakRule, DataSource, HijriMonth, PageInfo, ShiftHours, ShiftPattern } from '@/lib/types';
import type { BreakRow, Hours, PatternKind, PatternRow, PatternStatus, PrayerPolicyMode, RamadanInfo } from './types';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface ShiftsQuery {
  readonly q?: string | undefined;
  readonly kind?: PatternKind | undefined;
  readonly status?: PatternStatus | undefined;
  /** `?pattern=`: a pattern id, or `new`. */
  readonly pattern?: string | undefined;
}

export interface ShiftsView {
  readonly sources: readonly DataSource[];
  /** The Riyadh calendar day the week strip starts from and "Hours today" is read at: `YYYY-MM-DD`. */
  readonly today: string;
  readonly counts: { readonly active: number; readonly draft: number; readonly breaks: number };
  /** Every pattern (the week strip and the legend need all), and the ones matching the search and filters. */
  readonly all: readonly PatternRow[];
  readonly patterns: readonly PatternRow[];
  readonly breaks: readonly BreakRow[];
  /** Breaks and prayer (settings). */
  readonly prayer: { readonly mode: PrayerPolicyMode; readonly windowMinutes: number };
  readonly ramadan: RamadanInfo;
  /** The pattern `?pattern=` opens; undefined when there is none, it is `new`, or it does not exist. */
  readonly open: PatternRow | undefined;
  readonly unknownPattern: boolean;
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

const umalqura = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The first day of the next Ramadan on or after `from` (`YYYY-MM-DD`), or null when none is found in the next 420 days. */
export function nextRamadan(from: string): string | null {
  const start = Date.parse(`${from}T12:00:00Z`);
  for (let i = 0; i < 420; i += 1) {
    const day = new Date(start + i * 86_400_000);
    const parts = Object.fromEntries(umalqura.formatToParts(day).map((p) => [p.type, Number.parseInt(p.value, 10)]));
    if (parts['month'] === 9 && parts['day'] === 1) return day.toISOString().slice(0, 10);
  }
  return null;
}

function ramadanOf(months: readonly HijriMonth[], today: string): RamadanInfo {
  const ramadans = months.filter((m) => m.is_ramadan).sort((a, b) => a.gregorian_start.localeCompare(b.gregorian_start));
  const inside = ramadans.find((m) => m.gregorian_start <= today && today <= m.gregorian_end);
  const chosen = inside ?? [...ramadans].reverse().find((m) => m.gregorian_end < today) ?? ramadans[0];
  const upcoming = nextRamadan(inside === undefined ? today : inside.gregorian_end);
  return {
    window: chosen === undefined ? null : { from: chosen.gregorian_start, to: chosen.gregorian_end, hijriYear: chosen.hijri_year },
    next: upcoming,
    today: inside !== undefined,
  };
}

const hoursOf = (hours: ShiftHours): Hours | null => (hours.applies && hours.start_time !== undefined && hours.end_time !== undefined ? { start: hours.start_time, end: hours.end_time } : null);

export function patternRow(pattern: ShiftPattern, index: number): PatternRow {
  return {
    id: pattern.id,
    code: pattern.code,
    name: pattern.name_en,
    nameAr: pattern.name_ar,
    kind: pattern.kind,
    normal: hoursOf(pattern.normal),
    ramadan: hoursOf(pattern.ramadan),
    breakRuleId: pattern.break_rule_id,
    tone: ((index % 6) + 1) as PatternRow['tone'],
    status: pattern.status,
  };
}

export async function loadShiftsView(ctx: RequestContext, query: ShiftsQuery, now: Date = new Date()): Promise<ShiftsView> {
  const patterns = await listAll((cursor) => listShiftPatterns(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const breakRules = await listAll<BreakRule>((cursor) => listBreakRules(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const months = await listAll((cursor) => listHijriMonths(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const today = riyadhDay(now);
  const settings = await getSettingsSnapshot(ctx);

  const all = patterns.map(patternRow);
  const matches = (row: PatternRow): boolean =>
    (query.kind === undefined || row.kind === query.kind) && (query.status === undefined || row.status === query.status) && (query.q === undefined || query.q.trim() === '' || `${row.name} ${row.code}`.toLowerCase().includes(query.q.trim().toLowerCase()));
  const shown = all.filter(matches);
  const breaks: BreakRow[] = breakRules.map((b) => ({ id: b.id, code: b.code, name: b.name_en, nameAr: b.name_ar ?? null, minutes: b.break_minutes, afterHours: b.after_consecutive_hours }));
  const asked = query.pattern !== undefined && query.pattern !== 'new';
  const open = asked ? all.find((row) => row.id === query.pattern) : undefined;

  return {
    sources: [...new Set<DataSource>([...patterns, ...breakRules].map((r) => r.data_source))],
    today,
    counts: { active: all.filter((p) => p.status === 'active').length, draft: all.filter((p) => p.status === 'draft').length, breaks: breaks.length },
    all,
    patterns: shown,
    breaks,
    prayer: { mode: settings.break_prayer_policy ?? 'clear_of_prayer', windowMinutes: settings.prayer_window_minutes ?? 30 },
    ramadan: ramadanOf(months, today),
    open,
    unknownPattern: asked && open === undefined,
    exportHeader: ['code', 'name_en', 'kind', 'normal_start', 'normal_end', 'ramadan_start', 'ramadan_end', 'break_rule', 'status'],
    exportRows: shown.map((p) => [p.code, p.name, p.kind, p.normal?.start ?? '', p.normal?.end ?? '', p.ramadan?.start ?? '', p.ramadan?.end ?? '', breaks.find((b) => b.id === p.breakRuleId)?.code ?? '', p.status]),
  };
}
