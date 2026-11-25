'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Card, DataTable, StatusPill, useFormat, useToast, type Column, type Tone } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ReasonDialog } from '@/components/opendispatch/patterns/ReasonDialog';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { switchVersion } from './actions';
import { isPlaceholderRefusal, makeActiveBlock } from './versions';
import type { VersionRow, VersionStatus } from './types';
import styles from './ForecastModel.module.css';

// Model versions: the versions, the active one highlighted, and
// "Make active" for the others, through a dialog that needs a reason. THE MODEL IS A PLACEHOLDER: the card carries the
// Illustrative label. Making a version active notifies the Administrator and the Planner (the data layer writes the alert).

const TONE: Readonly<Record<VersionStatus, Tone>> = { active: 'success', candidate: 'info', retired: 'neutral', challenger: 'info' };

export interface VersionsCardProps {
  readonly versions: readonly VersionRow[];
  readonly activeVersion: string | null;
  readonly engineModel: string | null;
  readonly canEdit: boolean;
}

export function VersionsCard({ versions, activeVersion, engineModel, canEdit }: VersionsCardProps) {
  const m = useTranslations('admin.forecast_model');
  const t = useTranslations();
  const format = useFormat();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [target, setTarget] = useState<VersionRow | null>(null);
  const change = useAdminAction(switchVersion, {
    quiet: true,
    onSuccess: () => {
      toast({ title: m('toast.switched', { v: target?.version ?? '' }), description: m('toast.notified'), tone: 'success' });
      setTarget(null);
    },
  });

  const signed = (value: number | null) => (value === null ? '-' : `${value > 0 ? '+' : ''}${format.pct(value * 100, 1)}`);
  const sub = (row: VersionRow) =>
    row.status === 'challenger' ? (row.lift == null ? m('v.noLift') : m('v.lift', { wape: signed(row.lift.wape), mape: signed(row.lift.mape) })) : row.placeholder ? m('v.placeholder') : null;

  const columns: Column<VersionRow>[] = [
    {
      key: 'version',
      header: m('col.version'),
      cell: (row) => (
        <span className={styles.stackTight}>
          <span className={styles.strong} translate="no">
            {row.version}
          </span>
          {sub(row) === null ? null : <span className={styles.meta}>{sub(row)}</span>}
        </span>
      ),
    },
    { key: 'status', header: t('common.status'), cell: (row) => <StatusPill status={m(`status.${row.status}`)} tone={TONE[row.status]} size="sm" /> },
    { key: 'trained', header: m('col.trained'), hideBelow: 'md', cell: (row) => (row.trainedAt === null ? '-' : <span translate="no">{format.date(row.trainedAt)}</span>) },
    { key: 'engine', header: m('col.engine'), hideBelow: 'md', cell: (row) => <span translate="no">{row.engine ?? '-'}</span> },
    {
      key: 'action',
      header: <span className={styles.srOnly}>{m('col.action')}</span>,
      align: 'end',
      cell: (row) => {
        if (row.status === 'active') return <span className={styles.meta}>{m('v.current')}</span>;
        if (row.status === 'challenger') return <span className={styles.meta}>-</span>;
        const block = makeActiveBlock(row, engineModel);
        return (
          <ReasonHint reason={gate.edit.reason ?? (block === null ? null : m(`v.${block}`))} visible={false}>
            <Button variant="secondary" size="sm" onClick={() => gate.edit.allowed && block === null && setTarget(row)}>
              {m('v.makeActive')}
            </Button>
          </ReasonHint>
        );
      },
    },
  ];

  return (
    <Card padding="none">
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{m('v.title')}</h2>
        <IllustrativeLabel />
      </div>
      <DataTable pageSize={0} caption={m('v.title')} columns={columns} rows={[...versions]} getRowId={(row) => row.id} rowLabel={(row) => row.version} rowTone={(row) => (row.status === 'active' ? 'success' : undefined)} />
      {gate.edit.reason === null ? null : (
        <div className={styles.cardBody}>
          <Reason>{gate.edit.reason}</Reason>
        </div>
      )}
      <ReasonDialog
        open={target !== null}
        onClose={() => {
          setTarget(null);
          change.reset();
        }}
        onConfirm={(reason) => target !== null && change.run({ versionId: target.id, reason })}
        title={target === null ? '' : m('c.switch', { v: target.version })}
        description={target === null ? undefined : <span translate="no">{`${activeVersion ?? ''} -> ${target.version}`}</span>}
        confirmLabel={m('v.makeActive')}
        minLength={1}
        maxLength={300}
        size="sm"
        pending={change.pending}
        error={isPlaceholderRefusal(change.error) ? <Alert tone="warning" title={m('v.placeholderOff')} onDismiss={change.reset} /> : <ActionError error={change.error} onDismiss={change.reset} />}
      />
    </Card>
  );
}
