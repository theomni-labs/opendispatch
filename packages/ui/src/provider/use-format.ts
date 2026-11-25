// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useMemo } from 'react';
import {
  date,
  dateBoth,
  duration,
  formatDelta,
  formatNumber,
  formatPercent,
  int,
  num,
  pct,
  time,
  type DateOptions,
  type DateValue,
  type DurationMode,
  type TimeOptions,
} from '../format';
import { useLabels, useLocale } from './provider';

/** The format helpers with the provider's language applied. */
export interface Formatters {
  readonly locale: string;
  num: (value: number | null | undefined, digits?: number) => string;
  int: (value: number | null | undefined) => string;
  pct: (value: number | null | undefined, digits?: number) => string;
  ratio: (value: number | null | undefined, digits?: number) => string;
  formatNumber: (value: number | null | undefined, options?: Intl.NumberFormatOptions) => string;
  delta: (value: number | null | undefined, decimals?: 0 | 1 | 2) => string;
  time: (value: number | DateValue, options?: TimeOptions) => string;
  date: (value: DateValue, options?: Omit<DateOptions, 'locale'>) => string;
  dateBoth: (value: DateValue, options?: Omit<DateOptions, 'locale' | 'calendar'>) => string;
  duration: (seconds: number | null | undefined, mode?: DurationMode) => string;
}

/** Stable while the language and the minute label stay the same. */
export function useFormat(): Formatters {
  const locale = useLocale();
  const minute = useLabels()('duration.minuteShort');
  return useMemo<Formatters>(
    () => ({
      locale,
      num: (value, digits) => num(value, digits, locale),
      int: (value) => int(value, locale),
      pct: (value, digits) => pct(value, digits, locale),
      ratio: (value, digits) => formatPercent(value, locale, digits),
      formatNumber: (value, options) => formatNumber(value, locale, options),
      delta: (value, decimals) => formatDelta(value, decimals, locale),
      time: (value, options) => time(value, options),
      date: (value, options) => date(value, { ...options, locale }),
      dateBoth: (value, options) => dateBoth(value, { ...options, locale }),
      duration: (seconds, mode) => duration(seconds, mode, minute),
    }),
    [locale, minute],
  );
}
