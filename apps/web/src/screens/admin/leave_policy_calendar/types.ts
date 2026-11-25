// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Leave Policy and Calendar screen: what the server side hands to the client files.
// Everything here is JSON-safe. Nothing here is a context, a customer or the caller's role.

import type { GridWeek } from '@/components/opendispatch/month-grid-geometry';

export const HOLIDAY_KINDS = ['public', 'religious', 'observance'] as const;
export type HolidayKind = (typeof HOLIDAY_KINDS)[number];

export type CalendarMode = 'gregorian' | 'hijri';

export interface HolidayRow {
  readonly id: string;
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly kind: HolidayKind;
  /** `YYYY-MM-DD`, both ends included. */
  readonly from: string;
  readonly to: string;
  readonly days: number;
}

export interface PrayerRow {
  readonly cityId: string;
  readonly cityName: string;
  readonly fajr: string;
  readonly sunrise: string | null;
  readonly dhuhr: string;
  readonly asr: string;
  readonly maghrib: string;
  readonly isha: string;
  /** True when the row is stored; false when it was computed for the day shown (Umm al-Qura through `adhan`). */
  readonly stored: boolean;
}

export interface Blackout {
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

export interface PolicyData {
  readonly minNoticeDays: number;
  /** The most people on leave at once, as a percent of the crew (the data layer keeps a share from 0 to 1). */
  readonly sharePercent: number;
  readonly blackouts: readonly Blackout[];
}

/** The month the Calendar tab draws, and how to move to its neighbours. */
export interface MonthView {
  readonly mode: CalendarMode;
  /** `YYYY-MM` in the calendar's own count (a Hijri month is `1447-09`). */
  readonly key: string;
  readonly prev: string | null;
  readonly next: string | null;
  readonly weeks: readonly GridWeek[];
  /** Gregorian year and month (1 to 12) for a Gregorian grid; the Hijri year and the month's names for a Hijri one. */
  readonly year: number;
  readonly month: number;
  readonly monthNameEn: string | null;
  readonly monthNameAr: string | null;
  /** The first and last Gregorian day the grid covers. */
  readonly span: { readonly from: string; readonly to: string };
  /** The month the grid opens on today, so the "Today" button can go back to it. */
  readonly containsToday: boolean;
}

export interface RamadanMarker {
  readonly hijriYear: number;
  readonly from: string;
  readonly to: string;
  /** The `?month=` values that show it in each calendar. */
  readonly gregorianKey: string;
  readonly hijriKey: string;
}

/** The date-range kinds set on the Events tab. */
export const RANGE_KINDS = ['school', 'season', 'umrah'] as const;
export type RangeKind = (typeof RANGE_KINDS)[number];

/** One row of the Events tab. */
export interface EventRow {
  readonly id: string;
  readonly kind: RangeKind | 'derived' | 'customer' | 'notice';
  /** The forecaster's type (eid, hajj, ...); null for a range set here. */
  readonly eventType: string | null;
  /** English, or a customer school period code (vacation_summer, ...). */
  readonly name: string;
  readonly start: string;
  readonly end: string;
  readonly source: 'setting' | 'hijri' | 'fixed' | 'customer';
  readonly cities: readonly string[];
  readonly region: 'central' | 'western' | null;
  /** Saved from a notice: its details. */
  readonly notice?: NoticeInfo | undefined;
}

/** The event types a notice may carry. */
export const NOTICE_TYPES = ['sports_match', 'festival', 'concert', 'conference', 'road_closure', 'public_holiday', 'other'] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];
export const IMPACTS = ['low', 'medium', 'high'] as const;
export type Impact = (typeof IMPACTS)[number];

/** A notice event's details on the Events tab. */
export interface NoticeInfo {
  readonly noticeType: NoticeType;
  readonly impact: Impact;
  readonly zoneCodes: readonly string[];
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly quote: string | null;
}

/** A zone a notice event may name. */
export interface NoticeZone {
  readonly id: string;
  readonly code: string;
  /** English city name, as the api matches it. */
  readonly city: string;
}

/** Is the notice reader on, and may this role use it. */
export interface NoticeAssist {
  readonly configured: boolean;
  readonly allowed: boolean;
}

/** One draft event from the assistant, editable. */
export interface NoticeDraft {
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly noticeType: NoticeType;
  readonly city: string | null;
  readonly zoneIds: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly impact: Impact;
  readonly impactReason: string;
  readonly quote: string;
  readonly fromHijri: boolean;
}

/** What reading a notice returns. */
export interface NoticeRead {
  readonly provider: string;
  readonly model: string;
  readonly duration_ms: number;
  readonly drafts: readonly NoticeDraft[];
  readonly unmapped: readonly string[];
}

/** The Events tab: payday, ranges set here, derived and the customer events. */
export interface EventsView {
  /** 0: no payday day. */
  readonly paydayDay: number;
  readonly ranges: Readonly<Record<RangeKind, readonly EventRow[]>>;
  readonly derived: readonly EventRow[];
  /** Saved from notices. */
  readonly notices: readonly EventRow[];
  readonly zones: readonly NoticeZone[];
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types:
// no field here is a context, customer, user, role, zone scope or install mode.
// ---------------------------------------------------------------------------------------------

export interface SaveHolidayInput {
  /** The holiday being changed; absent when one is added. */
  readonly targetId?: string | undefined;
  readonly name_en: string;
  /** Empty: no Arabic name (English is shown). */
  readonly name_ar: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly kind: string;
}

export interface HolidayTarget {
  readonly targetId: string;
}

export interface RecomputeInput {
  readonly date_from: string;
  readonly date_to: string;
}

export interface SavePolicyInput {
  readonly min_notice_days: number;
  readonly share_percent: number;
  readonly blackout_periods: readonly { readonly start_date: string; readonly end_date: string; readonly label_en: string }[];
}

export interface SaveRangeInput {
  /** The range being changed; absent when one is added. */
  readonly targetId?: string | undefined;
  readonly kind: string;
  readonly name: string;
  readonly start_date: string;
  readonly end_date: string;
}

export interface ReadNoticeInput {
  readonly text: string;
  readonly locale: string;
}

/** A reviewed draft the person saves. */
export interface SaveNoticeInput {
  readonly name: string;
  readonly name_ar: string;
  readonly notice_type: string;
  readonly zone_ids: readonly string[];
  readonly start_date: string;
  readonly end_date: string;
  readonly start_time: string;
  readonly end_time: string;
  readonly impact: string;
  readonly impact_reason: string;
  readonly quote: string;
}

export interface RangeTarget {
  readonly targetId: string;
}

export interface PaydayInput {
  /** 0 removes it. */
  readonly payday_day: number;
}

export interface SavedRange {
  readonly id: string;
  readonly name: string;
  readonly created: boolean;
}

export interface SavedHoliday {
  readonly id: string;
  readonly name: string;
  readonly created: boolean;
}

export interface RecomputeResult {
  readonly cities: number;
  readonly days: number;
  readonly records: number;
}
