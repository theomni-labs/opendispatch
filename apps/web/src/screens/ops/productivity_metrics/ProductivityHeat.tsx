'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { HeatGrid } from '@opendispatch/ui/charts';
import { num } from '@opendispatch/ui/format';
import { useTranslations } from 'next-intl';
import styles from './ProductivityMetrics.module.css';
import type { HeatView } from './view';

// Zone by hour (#pm-heat), static

export interface ProductivityHeatProps {
  readonly heat: HeatView;
}

function formatDelta(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${num(Math.abs(v), 1)}`;
}

export function ProductivityHeat({ heat }: ProductivityHeatProps) {
  const m = useTranslations('ops.productivity_metrics');

  return (
    <div className={styles.gridStack}>
      <HeatGrid rows={[...heat.rows]} columns={[...heat.columns]} values={heat.values.map((row) => [...row])} kind="signed" format={formatDelta} minColWidth={56} label={m('heat.title')} />
      <ul className={styles.legend}>
        <li className={styles.key}>
          <i className={`${styles.swatch} ${styles.swatchGap}`} aria-hidden="true" />
          <span>{m('heat.slower')}</span>
        </li>
        <li className={styles.key}>
          <i className={`${styles.swatch} ${styles.swatchSurplus}`} aria-hidden="true" />
          <span>{m('heat.faster')}</span>
        </li>
        <li className={styles.key}>
          <span>{m(heat.clock === 'a' ? 'heat.unit' : 'heat.unitR')}</span>
        </li>
      </ul>
    </div>
  );
}
