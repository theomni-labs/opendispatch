'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Stat, useFormat } from '@opendispatch/ui';
import { Gauge, Hourglass, Timer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { FallbackPanel } from './FallbackPanel';
import styles from './Figures.module.css';
import type { FallbackView, ReadingPanelView, StageRow } from './types';

export interface FiguresProps {
  readonly waiting: number;
  readonly overReach: number;
  readonly reading: ReadingPanelView;
  readonly fallback: FallbackView;
  readonly stages: readonly StageRow[];
}

/** The four figures; the 10-minute one both ways, primary from the setting. */
export function Figures({ waiting, overReach, reading, fallback, stages }: FiguresProps) {
  const m = useTranslations('ops.live_dispatch_board');
  const t = useTranslations();
  const format = useFormat();
  const fromAssignment = reading.clockStart === 'assignment';
  const primary = fromAssignment ? reading.customer.fromAssignment : reading.customer.fromRegistration;
  const secondary = fromAssignment ? reading.customer.fromRegistration : reading.customer.fromAssignment;
  const tagged = (hint: string): ReactNode => (
    <span className={styles.hint}>
      <span>{hint}</span>
      {reading.illustrative ? <IllustrativeLabel /> : null}
    </span>
  );
  return (
    <div className={styles.grid}>
      <Stat label={m('board.col.waiting')} icon={<Hourglass />} value={<bdi translate="no">{format.int(waiting)}</bdi>} hint={t('opendispatch.dispatch.waitingCustomer')} />
      <Stat label={t('opendispatch.dispatch.overReach')} icon={<Timer />} value={<bdi translate="no">{format.int(overReach)}</bdi>} hint={tagged(m('fig.today'))} />
      {primary === null && secondary === null ? (
        <Stat label={m('read.title')} icon={<Gauge />} value={<span data-no-data="">—</span>} hint={m('fig.noData')} />
      ) : (
        <Stat
          label={m('read.title')}
          icon={<Gauge />}
          value={<bdi translate="no">{format.ratio(primary)}</bdi>}
          hint={tagged(
            secondary === null
              ? m(fromAssignment ? 'read.fromAssignment' : 'read.fromRegistration')
              : m(fromAssignment ? 'fig.within.assignment' : 'fig.within.registration', { value: format.ratio(secondary) }),
          )}
        />
      )}
      <FallbackPanel fallback={fallback} stages={stages} />
    </div>
  );
}
