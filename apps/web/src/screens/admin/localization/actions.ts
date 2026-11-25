'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Localization screen: updateLocalizationSettings of lib/data/system.ts, twice.
//
//   saveLocalization    the settings the form holds (STORED, NOT APPLIED: see below)
//   resetLocalization   the defaults of English, Western digits, Gregorian with the Hijri date beside it, Sunday
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. The time zone
// is fixed for the install (Asia/Riyadh): the browser does not send it, the action does.
//
// STORED, NOT APPLIED. The settings are audited and read back, but nothing in demo mode changes how a page is drawn: digits, calendars
// and the first day of the week follow the design system's formatter and, and the default language follows
// routing. The screen labels every setting "Not applied".

import { pickFields } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { updateLocalizationSettings } from '@/lib/data/system';
import { DEFAULT_SETTINGS, TIME_ZONE, type Settings, type SettingsInput } from './types';

const REVALIDATE = '/admin/localization';

function saved(result: { default_locale: Settings['default_locale']; digit_system: Settings['digit_system']; primary_calendar: Settings['primary_calendar']; show_secondary_calendar: boolean; first_day_of_week: Settings['first_day_of_week'] }): Settings {
  return {
    default_locale: result.default_locale,
    digit_system: result.digit_system,
    primary_calendar: result.primary_calendar,
    show_secondary_calendar: result.show_secondary_calendar,
    first_day_of_week: result.first_day_of_week,
  };
}

/** Saves the language, digits, calendars and first day of the week. */
export async function saveLocalization(input: SettingsInput): Promise<ActionResult<Settings>> {
  return runAction(
    async (ctx) => saved(await updateLocalizationSettings(ctx, { ...pickFields(input, ['default_locale', 'digit_system', 'primary_calendar', 'show_secondary_calendar', 'first_day_of_week']), time_zone: TIME_ZONE })),
    { revalidate: REVALIDATE },
  );
}

/** Writes the defaults. Takes no argument: there is nothing to type. */
export async function resetLocalization(): Promise<ActionResult<Settings>> {
  return runAction(async (ctx) => saved(await updateLocalizationSettings(ctx, { ...DEFAULT_SETTINGS, time_zone: TIME_ZONE })), { revalidate: REVALIDATE });
}
