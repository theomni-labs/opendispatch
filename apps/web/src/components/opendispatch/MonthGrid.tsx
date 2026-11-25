'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useFormat } from '@opendispatch/ui';
import { cx } from './cx';
import type { GridWeek } from './month-grid-geometry';
import styles from './MonthGrid.module.css';

// A month as a grid of days: Gregorian or Hijri, with today, the Ramadan
// window and the holidays marked, and the other calendar's day number under each day. It is a picture of a calendar, not a date
// picker: the weeks are built on the server (month-grid-geometry.ts) and the dates the reader picks are the DateInput's. The
// weekday names, the month's name and every label are the caller's, in the reader's language; day numbers are Western digits
// through the design system formatter. The weeks follow the page direction (Sunday at the start): unlike a time axis, a calendar
// grid mirrors in Arabic. A day with a holiday can be a button (`onSelect`), which the screen uses to open the holiday.
//
//   <MonthGrid label="September 2026" weekdays={['Sun', ...]} weeks={gregorianWeeks(2026, 9, context)} showSecondary markRamadan onSelect={open} />

export interface MonthGridProps {
  /** The name of the grid for assistive technology, for example "September 2026". */
  readonly label: string;
  /** Seven short weekday names, Sunday first. */
  readonly weekdays: readonly string[];
  readonly weeks: readonly GridWeek[];
  /** Shows the other calendar's day number under each day. */
  readonly showSecondary?: boolean | undefined;
  /** Tints the days of the Ramadan window. */
  readonly markRamadan?: boolean | undefined;
  /** The names of the states, for assistive technology: today and Ramadan. */
  readonly todayLabel: string;
  readonly ramadanLabel: string;
  /** Called with the holiday of the day that was pressed. Without it a holiday is text. */
  readonly onSelect?: ((holidayId: string) => void) | undefined;
}

export function MonthGrid({ label, weekdays, weeks, showSecondary = true, markRamadan = true, todayLabel, ramadanLabel, onSelect }: MonthGridProps) {
  const format = useFormat();
  return (
    <div className={styles.grid} role="grid" aria-label={label}>
      <div className={styles.row} role="row">
        {weekdays.map((name) => (
          <div key={name} className={styles.weekday} role="columnheader">
            {name}
          </div>
        ))}
      </div>
      {weeks.map((week, index) => (
        <div key={index} className={styles.row} role="row">
          {week.map((cell, position) =>
            cell === null ? (
              <div key={position} className={styles.empty} role="gridcell" aria-hidden="true" />
            ) : (
              <div
                key={cell.iso}
                className={cx(styles.cell, cell.holiday !== null && styles.holiday, markRamadan && cell.ramadan && styles.ramadan, cell.today && styles.today)}
                role="gridcell"
                aria-current={cell.today ? 'date' : undefined}
                data-date={cell.iso}
              >
                <span className={styles.day}>
                  <bdi translate="no">{format.int(cell.day)}</bdi>
                </span>
                {showSecondary ? (
                  <span className={styles.secondary}>
                    <bdi translate="no">{format.int(cell.secondary)}</bdi>
                  </span>
                ) : null}
                {cell.today ? <span className={styles.srOnly}>{todayLabel}</span> : null}
                {markRamadan && cell.ramadan ? <span className={styles.srOnly}>{ramadanLabel}</span> : null}
                {cell.holiday === null ? null : onSelect === undefined ? (
                  <span className={styles.name} translate="no">
                    {cell.holiday.name}
                  </span>
                ) : (
                  <button type="button" className={styles.link} translate="no" onClick={() => onSelect((cell.holiday as { id: string }).id)}>
                    {cell.holiday.name}
                  </button>
                )}
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
