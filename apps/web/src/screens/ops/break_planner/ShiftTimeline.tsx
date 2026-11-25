'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { SegmentedControl } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { RosterGrid, type RosterBand, type RosterRow } from '@/components/opendispatch/RosterGrid';
import styles from './BreakPlanner.module.css';

// One shift's timeline (#bp-shifts-wrap, #bp-grid)

export interface ShiftOption {
  readonly value: string;
  readonly label: string;
}

export interface ShiftTimelineProps {
  readonly shifts: readonly ShiftOption[];
  readonly shift: string;
  readonly rows: readonly RosterRow[];
  readonly bands: readonly RosterBand[];
  readonly startHour: number;
  readonly endHour: number;
}

export function ShiftTimeline({ shifts, shift, rows, bands, startHour, endHour }: ShiftTimelineProps) {
  const m = useTranslations('ops.break_planner');
  const t = useTranslations();
  const url = useUrlState();

  return (
    <div className={styles.timeline}>
      {shifts.length > 1 ? (
        <div className={styles.shiftTabs}>
          <SegmentedControl
            size="sm"
            ariaLabel={m('col.shift')}
            value={shift}
            onChange={(next) => {
              if (shifts.some((s) => s.value === next)) url.update({ shift: next, adjust: null }, { keepPage: true });
            }}
            options={shifts.map((s) => ({ value: s.value, label: s.label }))}
          />
        </div>
      ) : null}
      <div className={styles.gridWrap}>
        <RosterGrid
          rows={rows}
          headLabel={t('common.agent')}
          startHour={startHour}
          endHour={endHour}
          stepMin={15}
          bands={bands}
          selectLabel={m('adj.title')}
          onBlockSelect={(rowId) => url.update({ adjust: rowId }, { keepPage: true, history: 'push' })}
        />
      </div>
    </div>
  );
}
