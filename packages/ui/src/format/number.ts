// SPDX-License-Identifier: AGPL-3.0-only

import { NO_VALUE, resolveFormatLocale, stripBidiMarks, type FormatLocale } from './locale';

// Both languages write Western digits with comma grouping and a dot for decimals. The table is the one place a
// change of numbering system for Arabic would go.
const NUMBER_TAGS: Readonly<Record<FormatLocale, string>> = { en: 'en-US-u-nu-latn', ar: 'en-US-u-nu-latn' };

const formatCache = new Map<string, Intl.NumberFormat>();

function formatWith(locale: string | undefined, options: Intl.NumberFormatOptions, value: number): string {
  const tag = NUMBER_TAGS[resolveFormatLocale(locale)];
  const full: Intl.NumberFormatOptions = { signDisplay: 'negative', ...options };
  const key = `${tag} ${JSON.stringify(full)}`;
  let format = formatCache.get(key);
  if (!format) {
    format = new Intl.NumberFormat(tag, full);
    formatCache.set(key, format);
  }
  return stripBidiMarks(format.format(value));
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function places(digits: number | undefined): number | undefined {
  if (digits === undefined || !Number.isFinite(digits)) return undefined;
  return Math.max(0, Math.min(20, Math.trunc(digits)));
}

/** "1,234.5": at most one decimal, or exactly `digits` decimals when given. A value that rounds to zero has no sign. */
export function num(value: number | null | undefined, digits?: number, locale?: string): string {
  if (!finite(value)) return NO_VALUE;
  const fixed = places(digits);
  return formatWith(
    locale,
    fixed === undefined ? { maximumFractionDigits: 1 } : { minimumFractionDigits: fixed, maximumFractionDigits: fixed },
    value,
  );
}

/** A whole number with grouping: "1,235". */
export function int(value: number | null | undefined, locale?: string): string {
  return num(value, 0, locale);
}

/** A value already in percent: 91 gives "91%". The ASCII percent sign in both languages. */
export function pct(value: number | null | undefined, digits = 0, locale?: string): string {
  if (!finite(value)) return NO_VALUE;
  return `${num(value, digits, locale)}%`;
}

/** A number with Intl.NumberFormat options. Default: up to three decimals. */
export function formatNumber(value: number | null | undefined, locale?: string, options?: Intl.NumberFormatOptions): string {
  if (!finite(value)) return NO_VALUE;
  return formatWith(locale, options ?? {}, value);
}

/** A ratio as a percentage: 0.91 gives "91%". */
export function formatPercent(ratio: number | null | undefined, locale?: string, digits = 0): string {
  if (!finite(ratio)) return NO_VALUE;
  const fixed = places(digits) ?? 0;
  return formatWith(locale, { style: 'percent', minimumFractionDigits: fixed, maximumFractionDigits: fixed }, ratio);
}

/** A signed change in percent with a true minus sign: "+12.4%", "−3.1%". Zero has no sign. */
export function formatDelta(value: number | null | undefined, decimals: 0 | 1 | 2 = 1, locale?: string): string {
  if (!finite(value)) return NO_VALUE;
  let sign = '';
  if (value > 0) sign = '+';
  else if (value < 0) sign = '−';
  return `${sign}${formatWith(locale, { maximumFractionDigits: decimals }, Math.abs(value))}%`;
}

/** The first letter of the first two words, upper case: "Sara Haddad" gives "SH". */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => word.length > 0).slice(0, 2);
  return words.map((word) => ([...word][0] ?? '').toUpperCase()).join('');
}
