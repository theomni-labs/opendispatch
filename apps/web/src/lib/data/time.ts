// SPDX-License-Identifier: AGPL-3.0-only
// Shifts, holidays, prayer times: Go client.

import type { BreakRule, BreakRuleList, CalendarEvent, CalendarEvents, Holiday, HolidayList, HijriMonthList, LeavePolicy, PaydayDayUpdate, PrayerTimeList, ShiftPattern, ShiftPatternList } from '@/lib/types';
import { requireFound, requirePlatform, type PageQuery } from './context';
import { businessFetch } from './internal/business-client';
import { requireAccess, type RequestContext } from './guard';
import { pathSegment } from './internal/path-segment';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// ---------------------------------------------------------------------------------------------
// Shift patterns and break rules
// ---------------------------------------------------------------------------------------------

// operationId: listShiftPatterns
export async function listShiftPatterns(ctx: RequestContext, query: PageQuery = {}): Promise<ShiftPatternList> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<ShiftPatternList>(ctx, `/shift-patterns${qs({ limit: query.limit, cursor: query.cursor })}`))!;
}

// operationId: getShiftPattern
export async function getShiftPattern(ctx: RequestContext, id: string): Promise<ShiftPattern> {
  requirePlatform(ctx, 'platform.records');
  return requireFound(await businessFetch<ShiftPattern>(ctx, `/shift-patterns/${pathSegment(id)}`), 'Shift pattern');
}

// operationId: listBreakRules
export async function listBreakRules(ctx: RequestContext, query: PageQuery = {}): Promise<BreakRuleList> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<BreakRuleList>(ctx, `/break-rules${qs({ limit: query.limit, cursor: query.cursor })}`))!;
}

// operationId: createShiftPattern
export async function createShiftPattern(ctx: RequestContext, body: unknown): Promise<ShiftPattern> {
  return (await businessFetch<ShiftPattern>(ctx, '/shift-patterns', { method: 'POST', body }))!;
}

// operationId: updateShiftPattern
export async function updateShiftPattern(ctx: RequestContext, id: string, body: unknown): Promise<ShiftPattern> {
  return (await businessFetch<ShiftPattern>(ctx, `/shift-patterns/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: createBreakRule
export async function createBreakRule(ctx: RequestContext, body: unknown): Promise<BreakRule> {
  return (await businessFetch<BreakRule>(ctx, '/break-rules', { method: 'POST', body }))!;
}

// operationId: updateBreakRule
export async function updateBreakRule(ctx: RequestContext, id: string, body: unknown): Promise<BreakRule> {
  return (await businessFetch<BreakRule>(ctx, `/break-rules/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// ---------------------------------------------------------------------------------------------
// Holidays and Hijri months
// ---------------------------------------------------------------------------------------------

// operationId: listHolidays
export async function listHolidays(ctx: RequestContext, query: PageQuery & { readonly date_from?: string | undefined; readonly date_to?: string | undefined } = {}): Promise<HolidayList> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<HolidayList>(ctx, `/holidays${qs({ limit: query.limit, cursor: query.cursor, date_from: query.date_from, date_to: query.date_to })}`))!;
}

// operationId: createHoliday
export async function createHoliday(ctx: RequestContext, body: unknown): Promise<Holiday> {
  return (await businessFetch<Holiday>(ctx, '/holidays', { method: 'POST', body }))!;
}

// operationId: updateHoliday
export async function updateHoliday(ctx: RequestContext, id: string, body: unknown): Promise<Holiday> {
  return (await businessFetch<Holiday>(ctx, `/holidays/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: deleteHoliday
export async function deleteHoliday(ctx: RequestContext, id: string): Promise<void> {
  await businessFetch<void>(ctx, `/holidays/${pathSegment(id)}`, { method: 'DELETE' });
}

// operationId: listCalendarEvents
export async function listCalendarEvents(ctx: RequestContext, query: { readonly from?: string | undefined; readonly to?: string | undefined } = {}): Promise<CalendarEvents> {
  requireAccess(ctx, 'admin.leave_policy_calendar', 'view');
  return (await businessFetch<CalendarEvents>(ctx, `/calendar-events${qs({ from: query.from, to: query.to })}`))!;
}

// operationId: createCalendarEvent
export async function createCalendarEvent(ctx: RequestContext, body: unknown): Promise<CalendarEvent> {
  return (await businessFetch<CalendarEvent>(ctx, '/calendar-events', { method: 'POST', body }))!;
}

// operationId: updateCalendarEvent
export async function updateCalendarEvent(ctx: RequestContext, id: string, body: unknown): Promise<CalendarEvent> {
  return (await businessFetch<CalendarEvent>(ctx, `/calendar-events/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: deleteCalendarEvent
export async function deleteCalendarEvent(ctx: RequestContext, id: string): Promise<void> {
  await businessFetch<void>(ctx, `/calendar-events/${pathSegment(id)}`, { method: 'DELETE' });
}

// operationId: updatePaydayDay
export async function updatePaydayDay(ctx: RequestContext, body: unknown): Promise<PaydayDayUpdate> {
  return (await businessFetch<PaydayDayUpdate>(ctx, '/settings/payday-day', { method: 'PUT', body }))!;
}

// operationId: listHijriMonths
export async function listHijriMonths(ctx: RequestContext, query: PageQuery & { readonly date_from?: string | undefined; readonly date_to?: string | undefined } = {}): Promise<HijriMonthList> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<HijriMonthList>(ctx, `/hijri-months${qs({ limit: query.limit, cursor: query.cursor, date_from: query.date_from, date_to: query.date_to })}`))!;
}

// ---------------------------------------------------------------------------------------------
// Prayer times
// ---------------------------------------------------------------------------------------------

// operationId: listPrayerTimes
export async function listPrayerTimes(
  ctx: RequestContext,
  query: PageQuery & { readonly city_id?: string | undefined; readonly date_from?: string | undefined; readonly date_to?: string | undefined } = {},
): Promise<PrayerTimeList> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<PrayerTimeList>(ctx, `/prayer-times${qs({ limit: query.limit, cursor: query.cursor, city_id: query.city_id, date_from: query.date_from, date_to: query.date_to })}`))!;
}

/** Computes and stores prayer times for a range (all cities, or one). Replaces stored values for those dates. */
// operationId: recomputePrayerTimes
export async function recomputePrayerTimes(ctx: RequestContext, body: unknown): Promise<PrayerTimeList> {
  return (await businessFetch<PrayerTimeList>(ctx, '/prayer-times/recompute', { method: 'POST', body }))!;
}

// ---------------------------------------------------------------------------------------------
// Leave policy
// ---------------------------------------------------------------------------------------------

// operationId: getLeavePolicy
export async function getLeavePolicy(ctx: RequestContext): Promise<LeavePolicy> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<LeavePolicy>(ctx, '/leave-policy'))!;
}

// operationId: updateLeavePolicy
export async function updateLeavePolicy(ctx: RequestContext, body: unknown): Promise<LeavePolicy> {
  return (await businessFetch<LeavePolicy>(ctx, '/leave-policy', { method: 'PUT', body }))!;
}
