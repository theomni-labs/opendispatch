'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, DescriptionList, Stack } from '@opendispatch/ui';
import { LineChart } from '@opendispatch/ui/charts';
import { useTranslations } from 'next-intl';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { decideLeaveAction } from './actions';
import styles from './LeavePlanner.module.css';
import type { RequestRowView } from './view';

// Request detail (#lp-drawer)

export interface RequestDrawerProps {
  readonly row: RequestRowView | undefined;
  readonly canEdit: boolean;
}

export function RequestDrawer({ row, canEdit }: RequestDrawerProps) {
  const m = useTranslations('ops.leave_planner');
  const t = useTranslations();

  if (row === undefined) return <RecordDrawer open={false} title="" />;

  const pending = row.status === 'requested';
  const reason = !canEdit ? t('opendispatch.gate.viewOnly') : row.own ? m('own') : null;

  return <RequestDrawerBody row={row} pending={pending} reason={reason} />;
}

function RequestDrawerBody({ row, pending, reason }: { readonly row: RequestRowView; readonly pending: boolean; readonly reason: string | null }) {
  const m = useTranslations('ops.leave_planner');
  const t = useTranslations();
  const approve = useAdminAction(decideLeaveAction, { successTitle: m('toast.approved') });
  const decline = useAdminAction(decideLeaveAction, { successTitle: m('toast.declined') });
  const pendingAction = approve.pending || decline.pending;

  return (
    <RecordDrawer
      open
      recordKey={row.id}
      title={<span translate="no">{row.name}</span>}
      subtitle={
        <span translate="no" dir="ltr">
          {row.code}
          {row.zoneCode === null ? '' : ` · ${row.zoneCode}`}
        </span>
      }
      footer={
        pending ? (
          <>
            {reason === null ? null : <Reason>{reason}</Reason>}
            <span className={styles.push} />
            <ReasonHint reason={reason} visible={false}>
              <Button variant="secondary" loading={decline.pending} disabled={pendingAction} onClick={() => decline.run({ requestId: row.id, decision: 'declined' })}>
                {m('decline')}
              </Button>
            </ReasonHint>
            <ReasonHint reason={reason} visible={false}>
              <Button variant="primary" loading={approve.pending} disabled={pendingAction} onClick={() => approve.run({ requestId: row.id, decision: 'approved' })}>
                {t('common.approve')}
              </Button>
            </ReasonHint>
          </>
        ) : undefined
      }
    >
      <Stack gap={20}>
        <div className={styles.inline}>
          <Badge tone={row.status === 'approved' ? 'success' : row.status === 'declined' ? 'neutral' : 'warning'} dot>
            {m(`status.${row.status}`)}
          </Badge>
          <Badge>{m(`type.${row.leaveType}`)}</Badge>
          {row.own ? <Badge>{m('yours')}</Badge> : null}
        </div>
        <DescriptionList
          dense
          items={[
            {
              label: m('col.dates'),
              value: (
                <span translate="no">
                  {row.startLabel} – {row.endLabel}
                </span>
              ),
            },
            { label: m('d.onShift'), value: <span translate="no">{`${String(row.effect.daysAffected)} / ${String(row.days)}`}</span> },
            { label: m('d.requested'), value: <span translate="no">{row.requestedLabel}</span> },
            ...(row.decidedLabel === null ? [] : [{ label: m('d.decided'), value: <span translate="no">{row.decidedLabel}</span> }]),
            ...(row.note === null ? [] : [{ label: t('common.note'), value: <span dir="auto">{row.note}</span> }]),
          ]}
        />
        <div>
          <div className={styles.inline}>
            <h3 className="t-heading-s">{m('d.effect')}</h3>
            <IllustrativeLabel />
          </div>
          {row.effect.daysAffected === 0 ? (
            <p className="t-body-s">{m(row.kind === 'remote' ? 'eff.remote' : 'eff.none')}</p>
          ) : (
            <>
              <LineChart
                label={m('spark')}
                height={160}
                labels={[...row.effect.dayLabels]}
                series={[
                  { name: m('d.required'), data: [...row.effect.requiredByDay], color: 'var(--od-chart-6)', dashed: true },
                  { name: m('d.coverage'), data: [...row.effect.plannedByDay], color: 'var(--od-chart-1)' },
                ]}
              />
              <p className="t-caption">{m('d.summary', { d: row.effect.daysAffected, n: row.effect.newGapIntervals })}</p>
            </>
          )}
        </div>
        <ActionError
          error={approve.error ?? decline.error}
          onDismiss={() => {
            approve.reset();
            decline.reset();
          }}
        />
      </Stack>
    </RecordDrawer>
  );
}
