'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Stat, useFormat } from '@opendispatch/ui';
import type { ReactNode } from 'react';
import styles from './StatStrip.module.css';

// The summary row of a list page: at most 4 figures, each a value and a short label (minimal.md, the project rules). A
// fifth item is dropped, so a screen cannot break the limit by accident. Numbers go through the design system formatter
// (Western digits, both languages) and are marked translate="no". Four across, two by two below 1024px, also on a phone
// (the mockups' grid stats; the design system's Grid would drop to one column under 640px).

export interface StatItem {
  readonly label: string;
  /** A number is formatted for the reader's language; a string is shown as given (already formatted). */
  readonly value: number | string;
  readonly unit?: string | undefined;
  /** Three words at most; a string, or an element such as IllustrativeLabel. */
  readonly hint?: ReactNode;
}

export interface StatStripProps {
  readonly items: readonly StatItem[];
}

export const MAX_STATS = 4;

export function StatStrip({ items }: StatStripProps) {
  const format = useFormat();
  return (
    <div className={styles.grid}>
      {items.slice(0, MAX_STATS).map((item) => (
        <Stat
          key={item.label}
          label={item.label}
          value={<bdi translate="no">{typeof item.value === 'number' ? format.int(item.value) : item.value}</bdi>}
          {...(item.unit === undefined ? {} : { unit: item.unit })}
          {...(item.hint === undefined ? {} : { hint: item.hint })}
        />
      ))}
    </div>
  );
}
