'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { DataTable, StatusPill, Tag, type Column, type Tone } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import styles from './LeaveOutlook.module.css';
import { OUTLOOK_PAGE_SIZE, type OutlookStatus } from './outlook-types';

// Flagged weeks (#lp-out-rows); page kept locally.

export interface OutlookTableRow {
  readonly id: string;
  readonly week: number;
  readonly startLabel: string;
  readonly zoneCode: string;
  readonly status: OutlookStatus;
  readonly changeLabel: string;
  readonly room: number;
  readonly sickLabel: string;
  readonly reason: string;
}

const TONE: Readonly<Record<OutlookStatus, Tone>> = { grant: 'success', normal: 'neutral', restrict: 'danger' };

export function OutlookTable({ rows, empty }: { readonly rows: readonly OutlookTableRow[]; readonly empty: ReactNode }) {
  const m = useTranslations('ops.leave_planner');
  const t = useTranslations();
  const [page, setPage] = useState(1);
  const columns: Column<OutlookTableRow>[] = [
    {
      key: 'week',
      header: m('out.col.week'),
      cell: (r) => (
        <span className={styles.cellMain}>
          <span translate="no">{r.startLabel}</span>
          <span className={styles.cellSub}>{m('out.weekN', { n: r.week })}</span>
        </span>
      ),
    },
    {
      key: 'zone',
      header: t('common.zone'),
      cell: (r) => (
        <Tag color="gray">
          <span translate="no">{r.zoneCode}</span>
        </Tag>
      ),
    },
    {
      key: 'outlook',
      header: m('out.col.outlook'),
      cell: (r) => (
        <span className={styles.wrap}>
          <StatusPill status={m(`out.status.${r.status}`)} tone={TONE[r.status]} size="sm" />
          <span className={`${styles.cellSub} ${styles.narrowReason}`}>{r.reason}</span>
        </span>
      ),
    },
    {
      key: 'demand',
      header: m('out.col.demand'),
      align: 'end',
      hideBelow: 'md',
      cell: (r) => (
        <span dir="ltr" translate="no">
          {r.changeLabel}
        </span>
      ),
    },
    { key: 'sick', header: m('out.col.sick'), align: 'end', hideBelow: 'md', cell: (r) => <span translate="no">{r.sickLabel}</span> },
    { key: 'room', header: m('out.col.room'), align: 'end', hideBelow: 'md', cell: (r) => <span translate="no">{r.room}</span> },
    { key: 'reason', header: m('out.col.reason'), hideBelow: 'md', cell: (r) => <span className={styles.wrap}>{r.reason}</span> },
  ];
  return <DataTable columns={columns} rows={[...rows]} getRowId={(r) => r.id} caption={m('out.title')} pageSize={OUTLOOK_PAGE_SIZE} page={page} onPageChange={setPage} emptyState={empty} />;
}
