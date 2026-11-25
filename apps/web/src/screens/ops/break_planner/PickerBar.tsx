'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { IconButton, Select, useFormat } from '@opendispatch/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import type { PickerOption } from './view';
import styles from './BreakPlanner.module.css';
import mirror from '@/components/opendispatch/mirror.module.css';

// Zone and day picker (?zone= ?date=)

export interface PickerBarProps {
  readonly zoneOptions: readonly PickerOption[];
  readonly zoneId: string;
  readonly date: string;
  readonly prevDate: string;
  readonly nextDate: string;
}

export function PickerBar({ zoneOptions, zoneId, date, prevDate, nextDate }: PickerBarProps) {
  const m = useTranslations('ops.break_planner');
  const format = useFormat();
  const url = useUrlState();

  return (
    <div className={styles.picker}>
      {zoneOptions.length > 1 ? (
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
        <IconButton variant="secondary" size="sm" icon={<ChevronLeft className={mirror.mirror} />} label={m('picker.prevDay')} onClick={() => url.update({ date: prevDate })} />
        <span className={styles.dayLabel} translate="no">
          {format.date(date)}
        </span>
        <IconButton variant="secondary" size="sm" icon={<ChevronRight className={mirror.mirror} />} label={m('picker.nextDay')} onClick={() => url.update({ date: nextDate })} />
      </div>
    </div>
  );
}
