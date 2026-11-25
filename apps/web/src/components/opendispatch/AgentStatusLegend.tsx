'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { int } from '@opendispatch/ui/format';
import { useLocale, useTranslations } from 'next-intl';
import type { AgentLiveStatus } from '@/lib/types';
import { StatusDot } from './StatusDot';
import styles from './AgentStatusLegend.module.css';

// The kit's legend: a dot and count per status.

export interface AgentStatusLegendItem {
  readonly status: AgentLiveStatus;
  readonly count: number;
}

export interface AgentStatusLegendProps {
  readonly items: readonly AgentStatusLegendItem[];
}

export function AgentStatusLegend({ items }: AgentStatusLegendProps) {
  const t = useTranslations('opendispatch.status');
  const locale = useLocale();
  return (
    <ul className={styles.legend}>
      {items.map((item) => (
        <li key={item.status} className={styles.item}>
          <StatusDot status={item.status} decorative />
          <span className={styles.label}>{t(item.status)}</span>
          <span className={styles.value} dir="ltr" translate="no">
            {int(item.count, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}
