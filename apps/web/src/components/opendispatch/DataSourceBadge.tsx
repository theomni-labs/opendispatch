// SPDX-License-Identifier: AGPL-3.0-only
import { Tooltip } from '@opendispatch/ui';
import { FileSpreadsheet, FlaskConical, Layers, Radio, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DataSource } from '@/lib/types';
import { cx } from './cx';
import styles from './DataSourceBadge.module.css';

// the project rules: every screen that shows records shows where they come from, and says so when the
// sources are mixed. The mockup's databadge: category colour plus an icon plus the name, never colour alone.
// Synthetic is gold, Imported sample magenta, Live data green, Mixed gray.

/** Fixed display order, so a mixed badge always lists its sources the same way. */
const ORDER: readonly DataSource[] = ['SYNTHETIC', 'IMPORTED', 'LIVE'];

const APPEARANCE: Readonly<Record<DataSource, { className: string | undefined; Icon: LucideIcon }>> = {
  SYNTHETIC: { className: styles.synthetic, Icon: FlaskConical },
  IMPORTED: { className: styles.sample, Icon: FileSpreadsheet },
  LIVE: { className: styles.live, Icon: Radio },
};

export interface DataSourceBadgeProps {
  /** The data_source of every record on the screen. Duplicates are fine. */
  sources: readonly DataSource[];
  /** Mixed although only some sources are named. */
  mixed?: boolean;
}

interface BadgeProps {
  /** The value of `data-badge`: the source, or MIXED for the "Mixed" badge. */
  id: DataSource | 'MIXED';
  className: string | undefined;
  Icon?: LucideIcon;
  children: string;
}

function Badge({ id, className, Icon, children }: BadgeProps) {
  return (
    <span className={cx(styles.badge, className)} data-badge={id}>
      {Icon ? <Icon className={styles.icon} aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  );
}

export function DataSourceBadge({ sources, mixed = false }: DataSourceBadgeProps) {
  const t = useTranslations('dataSource');
  const distinct = ORDER.filter((source) => sources.includes(source));
  const names = distinct.map((source) => t(source));

  if (distinct.length === 0) {
    const text = `${t('label')}: ${t('none')}`;
    return (
      <Tooltip content={text}>
        <span className={styles.root} role="group" aria-label={text}>
          <span className={styles.badge}>
            <span>{t('none')}</span>
          </span>
        </span>
      </Tooltip>
    );
  }

  if (distinct.length === 1 && !mixed) {
    const source = distinct[0] as DataSource;
    const { className, Icon } = APPEARANCE[source];
    const text = `${t('label')}: ${names[0]}`;
    return (
      <Tooltip content={text}>
        <span className={styles.root} role="group" aria-label={text} data-source={source}>
          <Badge id={source} className={className} Icon={Icon}>
            {t(source)}
          </Badge>
        </span>
      </Tooltip>
    );
  }

  // Mixed: say so, then name every source it mixes, each in its own colour.
  const text = `${t('label')}: ${t('mixed')} (${names.join(', ')})`;
  return (
    <Tooltip content={text}>
      <span className={styles.root} role="group" aria-label={text} data-source="MIXED">
        <Badge id="MIXED" className={styles.mixed} Icon={Layers}>
          {t('mixed')}
        </Badge>
        {distinct.map((source) => (
          <Badge key={source} id={source} className={APPEARANCE[source].className} Icon={APPEARANCE[source].Icon}>
            {t(source)}
          </Badge>
        ))}
      </span>
    </Tooltip>
  );
}
