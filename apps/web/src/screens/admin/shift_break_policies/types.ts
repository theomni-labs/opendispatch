// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Shift and Break Policies screen: what the server side hands to the client files.
// Everything here is JSON-safe. Nothing here is a context, a customer or the caller's role.

export type PatternKind = 'field' | 'remote';
export type PatternStatus = 'active' | 'draft';
export type HoursMode = 'normal' | 'ramadan';

/** A shift's hours in one calendar mode: `HH:MM` to `HH:MM`, or null when the pattern does not run in that mode. */
export interface Hours {
  readonly start: string;
  readonly end: string;
}

export interface PatternRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: PatternKind;
  readonly normal: Hours | null;
  readonly ramadan: Hours | null;
  readonly breakRuleId: string;
  /** The chart colour (1 to 6) of the pattern in the ribbons and their legend. */
  readonly tone: 1 | 2 | 3 | 4 | 5 | 6;
  readonly status: PatternStatus;
}

export function patternName(row: Pick<PatternRow, 'name' | 'nameAr'>, locale: string): string {
  return locale === 'ar' && row.nameAr ? row.nameAr : row.name;
}

/** The name without its Ramadan note, for the legends. */
export function patternShortName(row: Pick<PatternRow, 'name' | 'nameAr'>, locale: string): string {
  return patternName(row, locale).replace(' (Ramadan only)', '').replace(' (رمضان فقط)', '');
}

export interface BreakRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string | null;
  readonly minutes: number;
  /** Consecutive hours worked before the break. */
  readonly afterHours: number;
}

export interface RamadanInfo {
  /** The Ramadan month of the reference table that holds the demo day, or the last one before it: `YYYY-MM-DD` both ends. */
  readonly window: { readonly from: string; readonly to: string; readonly hijriYear: number } | null;
  /** The first day of the next Ramadan after the demo day, from the Umm al-Qura calendar; null when none is found. */
  readonly next: string | null;
  /** The demo day is inside a Ramadan window. */
  readonly today: boolean;
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types:
// no field here is a context, customer, user, role, zone scope or install mode.
// ---------------------------------------------------------------------------------------------

export interface HoursInput {
  readonly applies: boolean;
  readonly start_time: string;
  readonly end_time: string;
}

export interface SavePatternInput {
  /** The pattern being changed; absent when one is added. */
  readonly targetId?: string | undefined;
  readonly name_en: string;
  /** The code, for an add. Ignored on a change (the code stays). */
  readonly code: string;
  readonly kind: string;
  readonly normal: HoursInput;
  readonly ramadan: HoursInput;
  readonly break_rule_id: string;
  readonly status: string;
}

export interface PatternTargets {
  readonly targetIds: readonly string[];
  readonly status: string;
}

export interface SaveBreakRuleInput {
  readonly targetId: string;
  readonly break_minutes: number;
  readonly after_consecutive_hours: number;
}

export interface SavedPattern {
  readonly id: string;
  readonly code: string;
  readonly created: boolean;
  readonly status: string;
}

export interface BulkResult {
  readonly changed: number;
  readonly failed: number;
  readonly status: string;
  readonly firstProblem?: string | undefined;
}

export interface SavedBreakRule {
  readonly id: string;
  readonly code: string;
}

export type PrayerPolicyMode = 'clear_of_prayer' | 'lined_up_with_prayer';
export const PRAYER_POLICIES: readonly PrayerPolicyMode[] = ['clear_of_prayer', 'lined_up_with_prayer'];
/** The windows offered, 5 to 90 minutes. */
export const PRAYER_WINDOWS: readonly number[] = Array.from({ length: 18 }, (_, i) => (i + 1) * 5);

/** What the browser sends: either or both. */
export interface PrayerPolicyInput {
  readonly prayer_policy?: string;
  readonly prayer_window_minutes?: number;
}

export interface SavedPrayerPolicy {
  readonly mode: PrayerPolicyMode;
  readonly windowMinutes: number;
}
