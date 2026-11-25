'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, EmptyState, Skeleton } from '@opendispatch/ui';
import { int } from '@opendispatch/ui/format';
import { Scale } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cx } from './cx';
import styles from './ShadowComparisonList.module.css';

// The kit's compare: OpenDispatch's pick beside the customer's.

export interface ShadowComparisonRow {
  /** Stable id for the row (the case id), for the React key and test queries. */
  readonly id: string;
  readonly caseNumber: string;
  readonly zone: string;
  /** Elapsed time since the replay day began, already formatted ("00:10"). */
  readonly time: string;
  readonly opendispatchName: string;
  readonly opendispatchMinutes: number;
  readonly customerName: string;
  readonly customerMinutes: number;
  /** True when both dispatches chose the same agent. */
  readonly same: boolean;
}

export interface ShadowComparisonListProps {
  readonly rows: readonly ShadowComparisonRow[];
  /** loading: skeleton rows. error: the error state (with a retry when `onRetry` is given). Default ready. */
  readonly state?: 'ready' | 'loading' | 'error' | undefined;
  readonly onRetry?: (() => void) | undefined;
}

const SKELETON_ROWS = 3;

export function ShadowComparisonList({ rows, state = 'ready', onRetry }: ShadowComparisonListProps) {
  const t = useTranslations('opendispatch.shadowComparison');
  const tSource = useTranslations('opendispatch.dispatch');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  if (state === 'loading') {
    return (
      <div className={styles.state} role="status" aria-busy="true">
        <span className={styles.srOnly}>{tCommon('loading')}</span>
        <div className={styles.skeletons} aria-hidden="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} width="100%" height={44} radius="md" />
          ))}
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={styles.state}>
        <EmptyState
          tone="danger"
          compact
          title={t('error')}
          action={onRetry ? <Button onClick={onRetry}>{tCommon('retry')}</Button> : undefined}
        />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={styles.state}>
        <EmptyState compact icon={<Scale />} title={t('empty')} />
      </div>
    );
  }

  return (
    <ul className={styles.list} role="list">
      <li className={cx(styles.row, styles.head)} aria-hidden="true">
        <span>{t('columnCase')}</span>
        <span>{t('columnOpenDispatch')}</span>
        <span>{t('columnDefault')}</span>
        <span />
      </li>
      {rows.map((row) => (
        <li key={row.id} className={styles.row}>
          <div className={cx(styles.side, styles.case)}>
            <span className={styles.caseNumber} translate="no">
              {row.caseNumber}
            </span>
            <span className={styles.sub} dir="ltr" translate="no">
              {row.zone} · {row.time}
            </span>
          </div>
          <div className={cx(styles.side, styles.opendispatch)}>
            <span className={styles.sideLabel}>{tSource('source.opendispatch')}</span>
            <span className={styles.name} translate="no">
              {row.opendispatchName}
            </span>
            <span className={styles.sub} dir="ltr" translate="no">
              {int(row.opendispatchMinutes, locale)} {tCommon('minShort')}
            </span>
          </div>
          <div className={cx(styles.side, styles.customer)}>
            <span className={styles.sideLabel}>{tSource('source.customer')}</span>
            <span className={styles.name} translate="no">
              {row.customerName}
            </span>
            <span className={styles.sub} dir="ltr" translate="no">
              {int(row.customerMinutes, locale)} {tCommon('minShort')}
            </span>
          </div>
          <Badge tone={row.same ? 'success' : 'neutral'} dot size="sm" className={styles.pill}>
            {row.same ? t('same') : t('different')}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
