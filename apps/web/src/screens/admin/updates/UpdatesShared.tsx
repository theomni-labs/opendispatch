'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Progress, StatusPill, type Tone, useFormat } from '@opendispatch/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { clockOf, dayOf, weekdayOf } from './dates';
import styles from './Updates.module.css';

// Small client pieces the tabs and dialogs of the Updates screen share: a line of text that is data (English, as the data layer
// wrote it), the check list of the mockup (check list: a pill, then a name and a detail), the date and window texts, and
// the download bar. Nothing here reads the data layer or the request context.

/** A text from the data layer (English): kept left to right and out of translation, so an Arabic page says honestly what it is. */
export function DataText({ children }: { children: ReactNode }) {
  return (
    <span lang="en" dir="ltr" translate="no">
      {children}
    </span>
  );
}

export interface CheckRow {
  readonly key: string;
  readonly tone: Tone;
  /** The pill's word (Passed, Running, Failed ...), in the reader's language. */
  readonly pill: string;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
}

/** The mockup's check list: a pill in one column, the name and its detail in the next, so names line up whatever the pill says. */
export function CheckList({ rows, label }: { rows: readonly CheckRow[]; label: string }) {
  return (
    <ul className={styles.checks} aria-label={label}>
      {rows.map((row) => (
        <li key={row.key}>
          <StatusPill status={row.pill} tone={row.tone} size="sm" />
          <span className={styles.checkText}>
            <span className={styles.strong}>{row.title}</span>
            {row.meta === undefined ? null : <span className={styles.meta}>{row.meta}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The day names and the writers of the screen's dates: `Sun 14 Sept 2026, 03:00 to 05:00` and `13 Sept 2026, 06:00`. */
export function useWhen() {
  const format = useFormat();
  // Arabic only: each part keeps its own direction.
  const isolate = useLocale() === 'ar' ? (text: string): string => `\u2068${text}\u2069` : (text: string): string => text;
  const m = useTranslations('admin.updates');
  const shortDay = (n: number) => m(`day.short.${n}`);
  const longDay = (n: number) => m(`day.long.${n}`);
  return {
    format,
    shortDay,
    longDay,
    /** `13 Sept 2026, 06:00` */
    dateTime: (iso: string | null | undefined) => (iso === null || iso === undefined ? '' : `${isolate(format.date(iso))}${m('win.sep')}${isolate(format.time(iso))}`),
    /** `Sun 14 Sept 2026` */
    weekdayDate: (iso: string) => `${isolate(shortDay(weekdayOf(dayOf(iso))))} ${isolate(format.date(iso))}`,
    /** `03:00 to 05:00` */
    range: (from: string, to: string) => m('range', { from, to }),
    /** `Sunday to Thursday` */
    rangeOfDays: (from: number, to: number) => m('win.range', { a: longDay(from), b: longDay(to) }),
    /** Between the names of days that are not in a row: ", " in English, the Arabic comma in Arabic. */
    separator: m('win.sep'),
    /** `Sun 14 Sept 2026, 03:00 to 05:00` */
    windowText: (start: string, end: string) => `${isolate(shortDay(weekdayOf(dayOf(start))))} ${isolate(format.date(start))}${m('win.sep')}${isolate(m('range', { from: clockOf(start), to: clockOf(end) }))}`,
  };
}

/** The download bar (the mockup's progress info): bytes done of bytes total, from the data layer's clock, never animated on its own. */
export function DownloadBar({ done, total, label, tone = 'info' }: { done: number; total: number; label: string; tone?: Tone }) {
  const format = useFormat();
  const m = useTranslations('admin.updates');
  const mb = (bytes: number) => `${format.int(Math.round(bytes / 1_000_000))} ${m('unit.mb')}`;
  const percent = total <= 0 ? 0 : Math.min(100, Math.round((done / total) * 100));
  return (
    <Progress
      value={percent}
      tone={tone}
      label={
        <span>
          {label} <span className={styles.meta}>{m('dl.of', { done: mb(done), total: mb(total) })}</span>
        </span>
      }
      valueLabel={format.pct(percent)}
      showValue
    />
  );
}
