// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Localization screen: what the server side hands to the client files. Everything here is
// JSON-safe. Nothing here is a context, a customer or the caller's role.

export const LOCALES = ['ar', 'en'] as const;
export type LocaleChoice = (typeof LOCALES)[number];
export const DIGIT_SYSTEMS = ['western', 'arabic_indic'] as const;
export type DigitSystem = (typeof DIGIT_SYSTEMS)[number];
export const CALENDARS = ['gregorian', 'hijri'] as const;
export type CalendarChoice = (typeof CALENDARS)[number];
export const WEEK_DAYS = ['saturday', 'sunday', 'monday'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

/** The settings as the form edits them. The time zone is fixed (Asia/Riyadh) and is not part of the form. */
export interface Settings {
  readonly default_locale: LocaleChoice;
  readonly digit_system: DigitSystem;
  readonly primary_calendar: CalendarChoice;
  readonly show_secondary_calendar: boolean;
  readonly first_day_of_week: WeekDay;
}

/** What "Reset to defaults" writes. */
export const DEFAULT_SETTINGS: Settings = { default_locale: 'en', digit_system: 'western', primary_calendar: 'gregorian', show_secondary_calendar: true, first_day_of_week: 'sunday' };

export const TIME_ZONE = 'Asia/Riyadh';

export type CoverageKind = 'cities' | 'zones' | 'subzones' | 'standby' | 'casetypes' | 'shifts' | 'breaks' | 'holidays';

/** How many records of a kind have an Arabic name. */
export interface CoverageRow {
  readonly kind: CoverageKind;
  readonly records: number;
  readonly arabic: number;
}

/** A record for the fallback preview: its English name and its Arabic one when it has one. */
export interface FallbackSample {
  readonly id: string;
  readonly english: string;
  readonly arabic: string | null;
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types: no field
// here is a context, customer, user, role, zone scope or install mode. The time zone is not sent: it is fixed on the server.
// ---------------------------------------------------------------------------------------------

export interface SettingsInput {
  readonly default_locale: string;
  readonly digit_system: string;
  readonly primary_calendar: string;
  readonly show_secondary_calendar: boolean;
  readonly first_day_of_week: string;
}
