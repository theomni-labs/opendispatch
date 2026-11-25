// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useLabels } from '../provider';
import styles from './chart.module.css';

export interface LegendItem {
  label: string;
  color: string;
  dashed?: boolean;
}

/** The series names with their colours, as a list the page can read. */
export function ChartLegend({ items }: { items: readonly LegendItem[] }) {
  const label = useLabels();
  return (
    <ul className={styles.legend} aria-label={label('chartLegend.label')}>
      {items.map((item) => (
        <li key={item.label} className={styles.legendItem}>
          <span
            className={item.dashed ? `${styles.swatch} ${styles.swatchDashed}` : styles.swatch}
            style={{ color: item.color }}
            aria-hidden="true"
          />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
