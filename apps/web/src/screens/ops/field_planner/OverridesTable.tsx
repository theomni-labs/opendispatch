'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Inline, StatusPill } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason } from '@/components/opendispatch/ReasonHint';
import { approveOverrideAction, rejectOverrideAction } from './actions';
import type { OverrideRowView } from './view';

// Overrides tab (#fp-ovr)

const STATUS_TONE: Readonly<Record<OverrideRowView['status'], 'warning' | 'success' | 'danger'>> = { pending: 'warning', approved: 'success', rejected: 'danger' };

function DecideCell({ row }: { readonly row: OverrideRowView }) {
  const m = useTranslations('ops.field_planner');
  const t = useTranslations();
  const approve = useAdminAction(approveOverrideAction, { successTitle: m('toast.oapproved'), failureToast: true });
  const reject = useAdminAction(rejectOverrideAction, { successTitle: m('toast.orejected'), failureToast: true });

  if (row.status !== 'pending') {
    return row.deciderName === null ? null : (
      <span className="t-caption" translate="no">
        {row.deciderName}
      </span>
    );
  }
  if (!row.canDecide) {
    return row.own ? <Reason>{m('r.own')}</Reason> : null;
  }
  return (
    <Inline gap={4} justify="end">
      <Button variant="secondary" size="sm" loading={reject.pending} onClick={() => reject.run({ overrideId: row.id })}>
        {t('common.reject')}
      </Button>
      <Button variant="secondary" size="sm" loading={approve.pending} onClick={() => approve.run({ overrideId: row.id })}>
        {t('common.approve')}
      </Button>
    </Inline>
  );
}

export interface OverridesTableProps {
  readonly rows: readonly OverrideRowView[];
}

export function OverridesTable({ rows }: OverridesTableProps) {
  const m = useTranslations('ops.field_planner');
  const t = useTranslations();

  const columns: AdminTableColumn[] = [
    { key: 'change', header: m('col.change') },
    { key: 'target', header: t('common.agent') },
    { key: 'reason', header: t('common.reason') },
    { key: 'by', header: m('col.by'), hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
    { key: 'actions', header: '', align: 'end' },
  ];

  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: row.id,
    label: row.changeLabel,
    cells: {
      change: <span>{m(`type.${row.changeType}`)}</span>,
      target: <span translate="no">{row.changeLabel}</span>,
      reason: (
        <span className="t-body-s">
          {t(`opendispatch.reasonCode.${row.reasonCode}`)}
          {row.note !== null && row.note !== '' ? (
            <span className="t-caption" translate="no">
              {row.note}
            </span>
          ) : null}
        </span>
      ),
      by: row.own ? <span>{m('you')}</span> : <span translate="no">{row.byName}</span>,
      status: <StatusPill status={m(`os.${row.status}`)} tone={STATUS_TONE[row.status]} size="sm" />,
      actions: <DecideCell row={row} />,
    },
  }));

  return (
    <AdminTable
      caption={m('tab.overrides')}
      columns={columns}
      rows={tableRows}
      rowParam={false}
      emptyState={<NoMatch title={t('states.empty.title')} clearParams={[]} />}
    />
  );
}
