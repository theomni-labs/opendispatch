'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { IconButton, SegmentedControl, Select, useFormat } from '@opendispatch/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import type { PickerOption } from './view';
import styles from './FieldPlanner.module.css';
import mirror from '@/components/opendispatch/mirror.module.css';

// Day or week, zone and day picker (?view= ?zone= ?date=)

export interface PickerBarProps {
  readonly view?: 'day' | 'week' | undefined;
  readonly zoneOptions: readonly PickerOption[];
  readonly zoneId: string;
  readonly date: string;
  readonly prevDate: string;
  readonly nextDate: string;
  /** The week's last day, in the Week view. */
  readonly weekEnd?: string | undefined;
}

export function PickerBar({ view = 'day', zoneOptions, zoneId, date, prevDate, nextDate, weekEnd }: PickerBarProps) {
  const m = useTranslations('ops.field_planner');
  const format = useFormat();
  const url = useUrlState();
  const week = view === 'week';

  return (
    <div className={styles.picker}>
      <SegmentedControl
        size="sm"
        aria-label={m('picker.view')}
        value={view}
        options={[
          { value: 'day', label: m('picker.day') },
          { value: 'week', label: m('picker.week') },
        ]}
        onChange={(next) => url.update({ view: next === 'week' ? 'week' : null, tab: null })}
      />
      {!week && zoneOptions.length > 1 ? (
        <Select
          width="auto"
          size="sm"
          aria-label={m('picker.zone')}
          value={zoneId}
          options={zoneOptions.map((zone) => ({ value: zone.id, label: `${zone.name} (${zone.code})` }))}
          onChange={(event) => url.update({ zone: event.target.value })}
        />
      ) : null}
      <div className={styles.dayNav}>
        <IconButton variant="secondary" size="sm" icon={<ChevronLeft className={mirror.mirror} />} label={m(week ? 'picker.prevWeek' : 'picker.prevDay')} onClick={() => url.update({ date: prevDate })} />
        <span className={`t-body-s ${styles.dayLabel}`} translate="no">
          {week && weekEnd !== undefined ? m('picker.weekOf', { from: format.date(date), to: format.date(weekEnd) }) : format.date(date)}
        </span>
        <IconButton variant="secondary" size="sm" icon={<ChevronRight className={mirror.mirror} />} label={m(week ? 'picker.nextWeek' : 'picker.nextDay')} onClick={() => url.update({ date: nextDate })} />
      </div>
    </div>
  );
}
