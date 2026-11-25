'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Card, DataTable, EmptyState, StatusPill, useFormat, type Column, type Tone } from '@opendispatch/ui';
import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import type { ExperimentRow, ExperimentStatus } from './types';
import styles from './ForecastModel.module.css';

// Experiments (mockup `#fm-x-title`: each backtest, challenger run and retrain with its data snapshot. Illustrative.

const TONE: Readonly<Record<ExperimentStatus, Tone>> = { running: 'info', succeeded: 'success', failed: 'danger' };

export function ExperimentsCard({ rows }: { rows: readonly ExperimentRow[] }) {
  const m = useTranslations('admin.forecast_model');
  const t = useTranslations();
  const format = useFormat();
  const columns: Column<ExperimentRow>[] = [
    {
      key: 'run',
      header: m('x.col.run'),
      cell: (row) => (
        <span className={styles.stackXs}>
          <span className={styles.strong}>{m(`x.kind.${row.kind}`)}</span>
          {row.challenger === null ? null : (
            <span className={styles.meta} translate="no">
              {row.challenger}
            </span>
          )}
        </span>
      ),
    },
    { key: 'trigger', header: m('x.col.trigger'), cell: (row) => m(`x.trigger.${row.trigger}`) },
    { key: 'model', header: m('x.col.model'), cell: (row) => <span translate="no">{row.model}</span> },
    {
      key: 'data',
      header: m('x.col.data'),
      hideBelow: 'md',
      cell: (row) => (
        <bdi dir="ltr" translate="no">
          {row.snapshot ?? '-'}
        </bdi>
      ),
    },
    { key: 'wape', header: m('x.col.wape'), align: 'end', cell: (row) => <bdi translate="no">{row.wape === null ? '-' : format.pct(row.wape * 100, 1)}</bdi> },
    { key: 'status', header: t('common.status'), cell: (row) => <StatusPill status={m(`x.status.${row.status}`)} tone={TONE[row.status]} size="sm" /> },
    {
      key: 'started',
      header: m('x.col.started'),
      hideBelow: 'md',
      cell: (row) => (row.startedAt === null ? '-' : <bdi translate="no">{`${format.date(row.startedAt)} ${format.time(row.startedAt)}`}</bdi>),
    },
  ];
  return (
    <Card padding="none">
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{m('x.title')}</h2>
        <IllustrativeLabel />
      </div>
      {rows.length === 0 ? (
        <div className={styles.cardBody}>
          <EmptyState compact icon={<FlaskConical />} title={m('x.empty')} />
        </div>
      ) : (
        <DataTable pageSize={0} caption={m('x.title')} columns={columns} rows={[...rows]} getRowId={(row) => row.id} rowLabel={(row) => m(`x.kind.${row.kind}`)} />
      )}
    </Card>
  );
}
