// SPDX-License-Identifier: AGPL-3.0-only
// The preview of the Localization screen: the same date and number written in Arabic and in English under the settings the form
// holds. ILLUSTRATIVE: it shows what the chosen settings WOULD look like, with the browser's `Intl`; the
// application does not draw its pages this way (digits and calendars follow the design system's formatter and. Pure: no
// React, no Next.

import type { LocaleChoice, Settings, WeekDay } from './types';

/** The instant every preview writes: a Sunday morning in Riyadh. */
export const DEMO_INSTANT = '2026-09-13T10:42:00+03:00';
const WEEK_REFERENCE: Readonly<Record<WeekDay, string>> = { saturday: '2026-09-12', sunday: '2026-09-13', monday: '2026-09-14' };
const ZONE = 'Asia/Riyadh';

export interface PreviewRows {
  readonly date: string;
  readonly datetime: string;
  readonly number: string;
  readonly percent: string;
  readonly time: string;
  readonly week: string;
}

function localeTag(lang: LocaleChoice, calendar: 'gregory' | 'islamic-umalqura', digits: Settings['digit_system']): string {
  const numbering = lang === 'ar' && digits === 'arabic_indic' ? 'arab' : 'latn';
  return `${lang === 'ar' ? 'ar-SA' : 'en-GB'}-u-ca-${calendar}-nu-${numbering}`;
}

function formatDate(lang: LocaleChoice, calendar: 'gregory' | 'islamic-umalqura', digits: Settings['digit_system'], month: 'short' | 'long', withTime: boolean): string {
  return new Intl.DateTimeFormat(localeTag(lang, calendar, digits), { day: 'numeric', month, year: 'numeric', timeZone: ZONE, ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(new Date(DEMO_INSTANT));
}

/** The six rows of one language's preview under `settings`. */
export function previewRows(lang: LocaleChoice, settings: Settings): PreviewRows {
  const primary = settings.primary_calendar === 'hijri' ? 'islamic-umalqura' : 'gregory';
  const secondary = settings.primary_calendar === 'hijri' ? 'gregory' : 'islamic-umalqura';
  const numbers = localeTag(lang, 'gregory', settings.digit_system);
  return {
    date: formatDate(lang, primary, settings.digit_system, 'short', false) + (settings.show_secondary_calendar ? ` · ${formatDate(lang, secondary, settings.digit_system, 'short', false)}` : ''),
    datetime: formatDate(lang, primary, settings.digit_system, 'long', true),
    number: new Intl.NumberFormat(numbers, { maximumFractionDigits: 1 }).format(1234567.8),
    percent: new Intl.NumberFormat(numbers, { style: 'percent' }).format(0.49),
    time: new Intl.DateTimeFormat(numbers, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONE }).format(new Date(DEMO_INSTANT)),
    week: new Intl.DateTimeFormat(numbers, { weekday: 'long', timeZone: ZONE }).format(new Date(`${WEEK_REFERENCE[settings.first_day_of_week]}T12:00:00+03:00`)),
  };
}
