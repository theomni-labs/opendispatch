'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, EmptyState, StatusPill, Tag, type Tone } from '@opendispatch/ui';
import { CalendarOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Reason } from '@/components/opendispatch/ReasonHint';
import { bulkDecideLeaveAction, decideLeaveAction } from './actions';
import { EffectSpark } from './EffectSpark';
import styles from './LeavePlanner.module.css';
import type { RequestRowView } from './view';

// Requests table (#lp-rows)

const STATUS_TONE: Readonly<Record<RequestRowView['status'], Tone>> = { requested: 'warning', approved: 'success', declined: 'neutral' };
const EFFECT_TONE: Readonly<Record<RequestRowView['effect']['chip'], Tone>> = { remote: 'neutral', none: 'neutral', gaps: 'danger', ok: 'success' };

function DecideCell({ row }: { readonly row: RequestRowView }) {
  const m = useTranslations('ops.leave_planner');
  const t = useTranslations();
  const approve = useAdminAction(decideLeaveAction, { successTitle: m('toast.approved'), failureToast: true });
  const decline = useAdminAction(decideLeaveAction, { successTitle: m('toast.declined'), failureToast: true });

  if (row.status !== 'requested') {
    return row.decidedLabel === null ? null : (
      <span className={styles.muted} translate="no">
        {row.decidedLabel}
      </span>
    );
  }
  if (!row.canDecide) return row.own ? <Reason>{m('own')}</Reason> : null;
  return (
    <span className={styles.rowActions}>
      <Button variant="primary" size="sm" loading={approve.pending} onClick={() => approve.run({ requestId: row.id, decision: 'approved' })}>
        {t('common.approve')}
      </Button>
      <Button variant="secondary" size="sm" loading={decline.pending} onClick={() => decline.run({ requestId: row.id, decision: 'declined' })}>
        {m('decline')}
      </Button>
    </span>
  );
}

function EffectCell({ effect }: { readonly effect: RequestRowView['effect'] }) {
  const m = useTranslations('ops.leave_planner');
  return (
    <span className={styles.effect}>
      <EffectSpark required={effect.requiredByDay} planned={effect.plannedByDay} label={m('spark')} />
      <StatusPill status={m(`eff.${effect.chip}`, { n: effect.newGapIntervals })} tone={EFFECT_TONE[effect.chip]} size="sm" />
    </span>
  );
}

export interface RequestsTableProps {
  readonly rows: readonly RequestRowView[];
  readonly canEdit: boolean;
  readonly pageSize: number;
  readonly page: number | undefined;
}

export function RequestsTable({ rows, canEdit, pageSize, page }: RequestsTableProps) {
  const m = useTranslations('ops.leave_planner');
  const t = useTranslations();
  const bulk = useAdminAction(bulkDecideLeaveAction, {
    successTitle: (result) => m('toast.bulk', { n: result.decided }),
    successDescription: (result) => (result.skipped === 0 ? undefined : m('toast.skipped', { n: result.skipped })),
    failureToast: true,
  });

  function decideSelected(ids: string[], clear: () => void, decision: 'approved' | 'declined') {
    if (!canEdit || ids.length === 0) return;
    bulk.run({ requestIds: ids, decision });
    clear();
  }

  const columns: AdminTableColumn[] = [
    { key: 'agent', header: t('common.agent') },
    { key: 'zone', header: t('common.zone'), hideBelow: 'md' },
    { key: 'dates', header: m('col.dates') },
    { key: 'status', header: t('common.status'), hideBelow: 'md' },
    {
      key: 'effect',
      header: (
        <span className={styles.inline}>
          {m('col.effect')}
          <IllustrativeLabel />
        </span>
      ),
    },
    { key: 'actions', header: '', align: 'end' },
  ];

  const tableRows: AdminTableRow[] = rows.map((row) => {
    const zoneCell: ReactNode =
      row.zoneCode === null ? (
        <span className={styles.muted}>{t('scopes.remote_pool')}</span>
      ) : (
        <Tag color="gray">
          <span translate="no">{row.zoneCode}</span>
        </Tag>
      );
    return {
      id: row.id,
      label: row.name,
      cells: {
        agent: (
          <span className={styles.cellMain}>
            <span translate="no">{row.name}</span>
            <span className={styles.cellSub} translate="no">
              {row.code}
            </span>
          </span>
        ),
        zone: zoneCell,
        dates: (
          <span className={styles.cellMain}>
            <span translate="no">{row.startLabel}</span>
            <span className={styles.cellSub}>
              {m('days', { n: row.days })} · {m(`type.${row.leaveType}`)}
            </span>
          </span>
        ),
        status: (
          <span className={styles.inline}>
            <StatusPill status={m(`status.${row.status}`)} tone={STATUS_TONE[row.status]} size="sm" />
            {row.own ? <Badge size="sm">{m('yours')}</Badge> : null}
          </span>
        ),
        effect: <EffectCell effect={row.effect} />,
        actions: <DecideCell row={row} />,
      },
    };
  });

  return (
    <AdminTable
      caption={m('req.title')}
      columns={columns}
      rows={tableRows}
      emptyState={<EmptyState compact icon={<CalendarOff />} title={m('rows.empty')} />}
      pageSize={pageSize}
      page={page}
      selectable={canEdit}
      bulkActions={(ids, clear) => (
        <>
          <Button variant="primary" size="sm" loading={bulk.pending} onClick={() => decideSelected(ids, clear, 'approved')}>
            {t('common.approve')}
          </Button>
          <Button variant="secondary" size="sm" loading={bulk.pending} onClick={() => decideSelected(ids, clear, 'declined')}>
            {m('decline')}
          </Button>
        </>
      )}
    />
  );
}
