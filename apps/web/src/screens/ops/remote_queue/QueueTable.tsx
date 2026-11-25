'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, StatusPill, type Tone } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Qualifier } from '@/components/opendispatch/Qualifier';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import styles from './RemoteQueue.module.css';
import type { QueueRowView } from './view';

// Queue table (#rq-rows)

const STAGE_TONE: Readonly<Record<QueueRowView['status'], Tone>> = { waiting: 'warning', in_review: 'info', done: 'success' };

export interface QueueTableProps {
  readonly rows: readonly QueueRowView[];
  readonly caption: string;
  readonly emptyState: ReactNode;
  readonly pageSize: number;
  readonly page: number | undefined;
  readonly canEdit: boolean;
}

export function QueueTable({ rows, caption, emptyState, pageSize, page, canEdit }: QueueTableProps) {
  const m = useTranslations('ops.remote_queue');
  const t = useTranslations();
  const url = useUrlState();

  const columns: AdminTableColumn[] = [
    { key: 'case', header: m('col.case') },
    { key: 'zone', header: t('common.zone'), hideBelow: 'md' },
    { key: 'handling', header: m('col.handling'), hideBelow: 'md' },
    { key: 'waiting', header: m('col.waiting'), align: 'end' },
    { key: 'stage', header: m('col.stage') },
    { key: 'reviewer', header: m('col.reviewer'), hideBelow: 'md' },
    { key: 'action', header: '', align: 'end' },
  ];

  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: row.id,
    label: row.caseNumber,
    cells: {
      case: (
        <span className={styles.cellMain}>
          <span translate="no">{row.caseNumber}</span>
          <span className={styles.cellSub} translate="no">
            {row.caseTypeLabel} · {m('parties', { n: row.parties })}
          </span>
        </span>
      ),
      zone: (
        <span className={styles.muted} translate="no">
          {row.zoneCode}
        </span>
      ),
      handling: (
        <span className={styles.cellMain}>
          <span>
            {m('handling.remote')} <Qualifier />
          </span>
          {row.rule === undefined ? null : (
            <span className={styles.cellSub} data-rule="">
              {row.rule.name === null ? m('rule.default') : <>{m('rule.label')} <bdi translate="no">{row.rule.name}</bdi></>}
            </span>
          )}
          {row.ai === undefined ? null : (
            <span className={styles.cellSub} data-ai="">
              {t('opendispatch.caseAi.summary', { handling: row.ai.handling === 'field' ? t('opendispatch.caseAi.handlingField') : t('opendispatch.caseAi.handlingRemote'), pct: `${row.ai.pct}%` })}
            </span>
          )}
        </span>
      ),
      waiting: (
        <span translate="no" dir="ltr">
          {row.waitLabel}
        </span>
      ),
      stage: (
        <StatusPill status={m(`stage.${row.status}`)} tone={STAGE_TONE[row.status]} size="sm" />
      ),
      reviewer: row.reviewerName === null ? <span className={styles.muted}>{'—'}</span> : <span translate="no">{row.reviewerName}</span>,
      action: row.canAssign ? (
        <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!canEdit) return;
              url.update({ assign: row.id }, { keepPage: true, history: 'push' });
            }}
          >
            {m('assignShort')}
          </Button>
        </ReasonHint>
      ) : null,
    },
  }));

  return <AdminTable columns={columns} rows={tableRows} caption={caption} emptyState={emptyState} rowParam={false} pageSize={pageSize} page={page} />;
}
