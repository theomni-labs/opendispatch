'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, IconButton } from '@opendispatch/ui';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import mirror from '@/components/opendispatch/mirror.module.css';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import styles from './RemoteQueue.module.css';

// Roster day picker (?date=)

export interface DayNavProps {
  readonly dateLabel: string;
  readonly prevDate: string;
  readonly nextDate: string;
}

export function DayNav({ dateLabel, prevDate, nextDate }: DayNavProps) {
  const m = useTranslations('ops.remote_queue');
  const url = useUrlState();

  return (
    <div className={styles.dayNav}>
      <IconButton variant="secondary" size="sm" icon={<ChevronLeft className={mirror.mirror} />} label={m('ro.prev')} onClick={() => url.update({ date: prevDate, pool: null })} />
      <Badge tone="neutral" icon={<CalendarDays />}>
        <span translate="no">{dateLabel}</span>
      </Badge>
      <IconButton variant="secondary" size="sm" icon={<ChevronRight className={mirror.mirror} />} label={m('ro.next')} onClick={() => url.update({ date: nextDate, pool: null })} />
    </div>
  );
}
