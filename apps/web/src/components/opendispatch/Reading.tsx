// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { IllustrativeLabel } from './IllustrativeLabel';
import styles from './Reading.module.css';

export interface ReadingItem {
  /** What is measured from where: "From assignment", "From registration". Already in the reader's language. */
  label: string;
  /** The figure, formatted for the reader by the design system formatter (for example "49%" or "9:57"). */
  value: ReactNode;
  /** A unit after the figure, for example "min". Already in the reader's language. */
  unit?: string | undefined;
  /** A short note under the figure. A primary reading with no note says "Primary, a setting". */
  note?: string | undefined;
  /** The reading the setting chose as the headline (default: from assignment). Highlighted; at most one. */
  primary?: boolean | undefined;
  /** Puts the "Illustrative" label after the figure. */
  illustrative?: boolean | undefined;
}

export interface ReadingProps {
  items: readonly ReadingItem[];
  /** Two columns and tighter padding, for a summary card. The primary note then moves into a tooltip. */
  compact?: boolean | undefined;
}

// the project rules: until the customer confirms when the 10-minute clock starts, the measure is always shown two ways
// (from registration and from assignment). The primary one comes from a setting and is never hard-coded here.
export function Reading({ items, compact = false }: ReadingProps) {
  const t = useTranslations('opendispatch.reading');
  return (
    <dl className={cx(styles.reading, compact && styles.compact)}>
      {items.map((item) => {
        const note = item.note ?? (item.primary ? t('primary') : undefined);
        return (
          <div
            key={item.label}
            className={cx(styles.item, item.primary && styles.primary)}
            data-primary={item.primary ? '' : undefined}
            title={compact ? note : undefined}
          >
            <dt className={styles.label}>{item.label}</dt>
            <dd className={styles.valueRow}>
              <span className={styles.value} dir="ltr" translate="no">
                {item.value}
              </span>
              {item.unit ? <span className={styles.unit}>{item.unit}</span> : null}
              {item.illustrative ? <IllustrativeLabel /> : null}
            </dd>
            {note ? <dd className={compact ? styles.srOnly : styles.note}>{note}</dd> : null}
          </div>
        );
      })}
    </dl>
  );
}
