'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Select, useFormat } from '@opendispatch/ui';
import { useId } from 'react';
import { cx } from './cx';
import styles from './HijriDateField.module.css';

// A Hijri date chosen from three Selects: day, month, year. The choices are
// the months of the reference table the data layer converts with (`listHijriMonths`: 2026 only, 13 months), so a date the table
// cannot convert can never be chosen and the write is never refused for it. The Gregorian date of the chosen day is written
// under the Selects, through the shared formatter (Western digits, both languages).
//
// The field holds no state: the parent owns the value and gets each change. Month names come from the table (English and
// Arabic); the labels of the three Selects and the caption come from the caller, so this file needs no message namespace.

export interface HijriMonthOption {
  readonly year: number;
  readonly month: number;
  readonly nameEn: string;
  readonly nameAr: string;
  /** The first Gregorian day of this Hijri month, `YYYY-MM-DD`. */
  readonly gregorianStart: string;
  /** The last Gregorian day of this Hijri month, `YYYY-MM-DD`. */
  readonly gregorianEnd: string;
}

export interface HijriDateValue {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface HijriDateFieldLabels {
  readonly day: string;
  readonly month: string;
  readonly year: string;
  /** The line under the Selects: for example "Same day: {date}". Receives the Gregorian date already formatted. */
  readonly caption: (gregorianDate: string) => string;
}

export interface HijriDateFieldProps {
  /** Names the group of three Selects for a screen reader, and is shown above them (for example "From"). */
  readonly legend: string;
  readonly months: readonly HijriMonthOption[];
  readonly value: HijriDateValue;
  readonly onChange: (next: HijriDateValue) => void;
  readonly labels: HijriDateFieldLabels;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` plus a number of days, by calendar arithmetic. */
export function addDays(day: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = day.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The number of days of a Hijri month of the table (29 or 30). */
export function monthLength(month: HijriMonthOption): number {
  const [ys = 1970, ms = 1, ds = 1] = month.gregorianStart.split('-').map((part) => Number.parseInt(part, 10));
  const [ye = 1970, me = 1, de = 1] = month.gregorianEnd.split('-').map((part) => Number.parseInt(part, 10));
  return Math.round((Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / DAY_MS) + 1;
}

/** The month of the table for a value, when the value names one. */
export function findMonth(months: readonly HijriMonthOption[], value: HijriDateValue): HijriMonthOption | undefined {
  return months.find((month) => month.year === value.year && month.month === value.month);
}

/** The Gregorian day of a Hijri value, or null when the table has no such month or the month is not that long. */
export function toGregorian(months: readonly HijriMonthOption[], value: HijriDateValue): string | null {
  const month = findMonth(months, value);
  if (month === undefined || value.day < 1 || value.day > monthLength(month)) return null;
  return addDays(month.gregorianStart, value.day - 1);
}

/** The first date the table offers: the first day of its first month. */
export function firstHijriDate(months: readonly HijriMonthOption[]): HijriDateValue | null {
  const first = [...months].sort((a, b) => a.gregorianStart.localeCompare(b.gregorianStart))[0];
  return first === undefined ? null : { year: first.year, month: first.month, day: 1 };
}

export function HijriDateField({ legend, months, value, onChange, labels, disabled = false, className }: HijriDateFieldProps) {
  const format = useFormat();
  const id = useId();
  const arabic = format.locale.toLowerCase().startsWith('ar');
  const ordered = [...months].sort((a, b) => a.gregorianStart.localeCompare(b.gregorianStart));
  const years = [...new Set(ordered.map((month) => month.year))];
  const inYear = ordered.filter((month) => month.year === value.year);
  const current = findMonth(ordered, value) ?? inYear[0] ?? ordered[0];
  const length = current === undefined ? 30 : monthLength(current);
  const day = Math.min(Math.max(value.day, 1), length);
  const gregorian = toGregorian(ordered, { ...value, day });
  const nameOf = (month: HijriMonthOption) => (arabic ? month.nameAr : month.nameEn);

  function pick(next: { year?: number; month?: number; day?: number }) {
    if (Object.values(next).some((n) => !Number.isInteger(n))) return;
    const year = next.year ?? value.year;
    let monthNumber = next.month ?? value.month;
    // A year change keeps the month when the year has it, else the first month of that year.
    if (next.year !== undefined && !ordered.some((month) => month.year === year && month.month === monthNumber)) monthNumber = ordered.find((month) => month.year === year)?.month ?? monthNumber;
    const target = ordered.find((month) => month.year === year && month.month === monthNumber);
    const max = target === undefined ? 30 : monthLength(target);
    onChange({ year, month: monthNumber, day: Math.min(next.day ?? day, max) });
  }

  return (
    <fieldset className={cx(styles.field, className)} disabled={disabled}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.row}>
        <div className={styles.day}>
          <Select
            aria-label={`${legend}: ${labels.day}`}
            value={String(day)}
            onChange={(event) => pick({ day: Number.parseInt(event.target.value, 10) })}
            options={Array.from({ length }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))}
          />
        </div>
        <div className={styles.month}>
          <Select
            aria-label={`${legend}: ${labels.month}`}
            value={String(current?.month ?? value.month)}
            onChange={(event) => pick({ month: Number.parseInt(event.target.value, 10) })}
            options={(inYear.length === 0 ? ordered : inYear).map((month) => ({ value: String(month.month), label: nameOf(month) }))}
          />
        </div>
        <div className={styles.year}>
          <Select
            aria-label={`${legend}: ${labels.year}`}
            value={String(value.year)}
            onChange={(event) => pick({ year: Number.parseInt(event.target.value, 10) })}
            options={years.map((year) => ({ value: String(year), label: String(year) }))}
          />
        </div>
      </div>
      {gregorian === null ? null : (
        // The whole line is text in the page's language and direction (the date inside it follows the bidi rules like any date in
        // an Arabic sentence); it is not data, so it is not marked translate="no" or left to right.
        <p id={`${id}-caption`} className={styles.caption}>
          {labels.caption(format.date(gregorian))}
        </p>
      )}
    </fieldset>
  );
}
