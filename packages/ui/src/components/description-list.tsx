// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useLabels } from '../provider';
import { cx } from '../types';
import styles from './description-list.module.css';

export interface DescriptionListItem {
  label: string;
  value: ReactNode;
  span?: 1 | 2 | 3 | 4;
}

export interface DescriptionListProps {
  items: DescriptionListItem[];
  columns?: 1 | 2 | 3 | 4;
  dense?: boolean;
  className?: string | undefined;
}

/**
 * Label and value pairs as a real <dl>, laid out in columns like Ant Design's Descriptions (whose table markup would
 * lose the term and definition roles). An empty value shows a dash.
 */
export function DescriptionList({ items, columns = 2, dense = false, className }: DescriptionListProps) {
  const label = useLabels();
  const grid: CSSProperties & Record<'--od-dl-columns', number> = { '--od-dl-columns': columns };
  return (
    <dl className={cx(styles.list, dense && styles.dense, className)} style={grid}>
      {items.map((item, index) => {
        const span = Math.min(item.span ?? 1, columns);
        const empty = item.value === null || item.value === undefined || item.value === '';
        return (
          <div key={`${item.label}-${String(index)}`} className={styles.item} style={{ '--od-dl-span': span } as CSSProperties}>
            <dt className={styles.term}>{item.label}</dt>
            <dd className={cx(styles.value, empty && styles.empty)}>{empty ? label('descriptionList.empty') : item.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
