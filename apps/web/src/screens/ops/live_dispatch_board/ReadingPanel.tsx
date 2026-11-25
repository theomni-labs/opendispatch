'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Card, SegmentedControl, useFormat } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Reading, type ReadingItem } from '@/components/opendispatch/Reading';
import styles from './ReadingPanel.module.css';
import type { ReadingPanelView } from './types';

export interface ReadingPanelProps {
  readonly reading: ReadingPanelView;
}

const KEYS = ['fromAssignment', 'fromRegistration'] as const;

/** Rule 7: the 10-minute measure, always both ways, the primary one from the setting; the customer beside OpenDispatch shadow. */
export function ReadingPanel({ reading }: ReadingPanelProps) {
  const m = useTranslations('ops.live_dispatch_board');
  const tCmp = useTranslations('opendispatch.shadowComparison');
  const format = useFormat();
  const [source, setSource] = useState<'customer' | 'opendispatch'>('customer');
  const side = reading[source];

  const items: ReadingItem[] = KEYS.map((key) => ({
    label: m(`read.${key}`),
    value: format.ratio(side[key]),
    primary: (key === 'fromAssignment') === (reading.clockStart === 'assignment'),
    illustrative: reading.illustrative,
  })).sort((a, b) => Number(b.primary) - Number(a.primary));

  return (
    <Card padding="lg">
      <div className={styles.headRow}>
        <h2 className={styles.title}>{m('read.title')}</h2>
        <SegmentedControl
          size="sm"
          ariaLabel={m('read.source')}
          value={source}
          onChange={(next) => setSource(next === 'opendispatch' ? 'opendispatch' : 'customer')}
          options={[
            { value: 'customer', label: m('read.customer') },
            { value: 'opendispatch', label: m('read.opendispatch') },
          ]}
        />
      </div>
      <Reading items={items} />
      <p className={styles.scope}>{reading.casesCompared === 0 ? tCmp('empty') : m('read.scope', { count: reading.casesCompared, from: reading.fromDate, to: reading.toDate })}</p>
    </Card>
  );
}
