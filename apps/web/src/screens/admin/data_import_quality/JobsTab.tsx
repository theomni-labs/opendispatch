'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Card, StatusPill, useFormat, type Tone } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import type { JobRow, JobStatus } from './types';
import styles from './DataImport.module.css';
import { useDateTime } from '@/components/opendispatch/useDateTime';

// The Jobs tab: every import with its status, rows, errors and
// warnings and when it was validated and cut over. A row opens that job on the Import tab (`?job=`).

const TONE: Readonly<Record<JobStatus, Tone>> = { cut_over: 'success', validated: 'info', compared: 'info', dry_run_done: 'accent', uploaded: 'neutral', validating: 'neutral', failed: 'danger', rolled_back: 'neutral' };

export function JobsTab({ jobs, currentId }: { jobs: readonly JobRow[]; currentId: string | null }) {
  const m = useTranslations('admin.data_import_quality');
  const t = useTranslations();
  const format = useFormat();
  const dateTime = useDateTime();
  const url = useUrlState();
  const at = (iso: string | null) => (iso === null ? '-' : dateTime(iso));

  const columns: AdminTableColumn[] = [
    { key: 'file', header: m('col.file') },
    { key: 'status', header: t('common.status') },
    { key: 'rows', header: m('col.rows'), align: 'end' },
    { key: 'errors', header: m('stat.errors'), align: 'end' },
    { key: 'warnings', header: m('stat.warnings'), align: 'end', hideBelow: 'md' },
    { key: 'validated', header: m('col.validated'), hideBelow: 'md' },
    { key: 'cut', header: m('col.cut'), hideBelow: 'lg' },
  ];
  const rows: AdminTableRow[] = jobs.map((job) => {
    const uploaded = job.status === 'uploaded' || job.status === 'validating';
    return {
      id: job.id,
      href: url.hrefFor({ tab: null, job: job.id, q: null, severity: null, status: null, type: null, issue: null }),
      cells: {
        file: (
          <span className={styles.stackTight}>
            <span className={job.id === currentId ? styles.strong : undefined} translate="no">
              {job.file}
            </span>
            <span className={styles.meta} translate="no">
              {job.mappingLabel}
            </span>
          </span>
        ),
        status: <StatusPill status={m(`status.${job.status === 'validating' ? 'uploaded' : job.status}`)} tone={TONE[job.status]} size="sm" />,
        rows: <bdi translate="no">{format.int(job.rows)}</bdi>,
        errors: <bdi translate="no">{uploaded ? '-' : format.int(job.errors)}</bdi>,
        warnings: <bdi translate="no">{uploaded ? '-' : format.int(job.warnings)}</bdi>,
        validated: <bdi dir="ltr" translate="no">{at(job.validatedAt)}</bdi>,
        cut: <bdi dir="ltr" translate="no">{at(job.cutOverAt)}</bdi>,
      },
    };
  });

  return (
    <Card padding="none">
      <AdminTable caption={m('tab.jobs')} columns={columns} rows={rows} rowParam="job" pageSize={0} />
    </Card>
  );
}
