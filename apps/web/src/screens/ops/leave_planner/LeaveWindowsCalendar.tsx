// SPDX-License-Identifier: AGPL-3.0-only
import { getTranslations } from 'next-intl/server';
import type { CSSProperties } from 'react';
import { cx } from '@/components/opendispatch/cx';
import styles from './LeavePlanner.module.css';
import type { LeaveWindowsView } from './view';

type GridStyle = CSSProperties & { [name: `--${string}`]: string | number };

// Leave windows (#lp-cal), Server Component

export interface LeaveWindowsCalendarProps {
  readonly windows: LeaveWindowsView;
}

export async function LeaveWindowsCalendar({ windows }: LeaveWindowsCalendarProps) {
  const m = await getTranslations('ops.leave_planner');
  const columns = windows.days.length;

  if (columns === 0) return null;
  const trackStyle: GridStyle = { '--lp-cols': columns };

  return (
    <div className={styles.calendar} style={trackStyle}>
      <div className={styles.calRow}>
        <span className={styles.calLabel} />
        <div className={styles.calTrack}>
          {windows.weekHeaders.map((week, i) => (
            <span key={`w-${String(i)}`} className={styles.calWeek} translate="no">
              {week.label}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.calRow}>
        <span className={styles.calLabel} />
        <div className={styles.calTrack}>
          {windows.days.map((day) => (
            <span key={day.date} className={cx(styles.calDay, day.isHoliday && styles.calDayHoliday)} translate="no" title={day.holidayName ?? undefined}>
              {day.dayOfMonth}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.calRow}>
        <span className={styles.calLabel}>{m('win.demand')}</span>
        <div className={styles.calTrack}>
          {windows.days.map((day) => {
            const barStyle: GridStyle = { '--lp-v': day.demandPercent };
            return (
              <span key={day.date} className={styles.calDem}>
                <i className={cx(styles.calDemBar, day.isHoliday && styles.calDemBarHoliday)} style={barStyle} />
              </span>
            );
          })}
        </div>
      </div>
      {windows.zones.map((zone) => (
        <div key={zone.zoneCode} className={styles.calRow}>
          <span className={styles.calLabel} translate="no">
            {zone.zoneCode}
          </span>
          <div className={styles.calTrack}>
            {zone.days.map((day, i) => {
              const total = day.approved + day.requested;
              const isRecommended = day.recommended && total === 0;
              return (
                <span
                  key={`${zone.zoneCode}-${String(i)}`}
                  className={cx(
                    styles.calCell,
                    isRecommended && styles.calCellRec,
                    day.approved > 0 && styles.calCellApproved,
                    day.requested > 0 && styles.calCellRequested,
                  )}
                  translate="no"
                >
                  {total === 0 ? '' : total}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
