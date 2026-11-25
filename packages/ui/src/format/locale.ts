// SPDX-License-Identifier: AGPL-3.0-only

/** The two languages the formatters write. Any other tag is written as English. */
export type FormatLocale = 'en' | 'ar';

/** What a formatter returns for a missing value: null, undefined, NaN, Infinity or a date that does not exist. */
export const NO_VALUE = '-';

const DIRECTION_MARKS = /[‎‏؜]/g;

/** Drops the left-to-right, right-to-left and Arabic letter marks that Intl adds to some Arabic output. */
export function stripBidiMarks(text: string): string {
  return text.replace(DIRECTION_MARKS, '');
}

/** "ar", "ar-SA" and "AR_sa" are Arabic. Everything else, undefined included, is English. */
export function resolveFormatLocale(locale: string | null | undefined): FormatLocale {
  if (!locale) return 'en';
  const language = locale.split(/[-_]/, 1)[0]?.toLowerCase();
  return language === 'ar' ? 'ar' : 'en';
}

const collatorCache = new Map<string, Intl.Collator>();

/** A collator that sorts "item 2" before "item 10" and ignores case and accents. A malformed tag sorts as English. */
export function textCollator(locale: string): Intl.Collator {
  let tag = 'en';
  try {
    tag = Intl.getCanonicalLocales(locale)[0] ?? 'en';
  } catch {
    tag = 'en';
  }
  const cached = collatorCache.get(tag);
  if (cached) return cached;
  const made = new Intl.Collator(tag, { numeric: true, sensitivity: 'base' });
  collatorCache.set(tag, made);
  return made;
}
