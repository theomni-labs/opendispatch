'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Card, DataTable, SegmentedControl, useFormat, type Column } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, useGate } from '@/components/opendispatch/ReasonHint';
import { StageChip } from '@/components/opendispatch/StageChip';
import { changeStage } from './actions';
import { ReasonModal } from './ReasonModal';
import { STAGES, type LiveStage, type ZoneRow } from './types';
import styles from './DataSources.module.css';

// The stage per zone: shadow, recommend or
// automatic for each zone, set through a confirm dialog with an optional reason. The automatic stage warns that OpenDispatch assigns
// without a dispatcher and that the fallback stays armed. GUARDRAIL 11 (no automatic stage without shadow results and
// a tested fallback) IS NOT ENFORCED: the data layer accepts the change, and the dialog says so with a "Not applied" tag.

interface Pending {
  readonly zone: ZoneRow;
  readonly to: LiveStage;
}

/**
 * The id of the zone's code in its row. The stage control is named by it (`aria-labelledby`, not an `aria-label` that would put a
 * Latin code into an Arabic page's accessible names: an attribute cannot carry `translate="no"`, the element it points at can).
 */
const codeId = (row: ZoneRow): string => `ds-zone-${row.id}`;

export interface StageTableProps {
  readonly zones: readonly ZoneRow[];
  readonly canEdit: boolean;
}

export function StageTable({ zones, canEdit }: StageTableProps) {
  const m = useTranslations('admin.data_sources');
  const t = useTranslations();
  const format = useFormat();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [pending, setPending] = useState<Pending | null>(null);
  const stageName = (stage: LiveStage) => t(`opendispatch.stage.${stage}`);
  const change = useAdminAction(changeStage, {
    successTitle: (result) => {
      const zone = zones.find((z) => z.id === result.zoneId);
      return m('toast.stage', { zone: zone?.code ?? '', stage: stageName(result.stage) });
    },
    onSuccess: () => setPending(null),
  });

  const columns: Column<ZoneRow>[] = [
    {
      key: 'zone',
      header: t('common.zone'),
      cell: (row) => (
        <span className={styles.stackTight}>
          <span className={styles.strong} translate="no">
            {row.name}
          </span>
          <span className={styles.meta} translate="no" id={codeId(row)}>
            {row.code}
          </span>
        </span>
      ),
    },
    { key: 'city', header: m('col.city'), hideBelow: 'md', cell: (row) => <span translate="no">{row.city}</span> },
    { key: 'stage', header: m('shared.stage.label'), cell: (row) => <StageChip zone={row.code} stage={row.stage} /> },
    {
      key: 'set',
      header: m('col.set'),
      cell: (row) => (
        <fieldset className={styles.plainFieldset} disabled={!canEdit || change.pending}>
          <SegmentedControl
            size="sm"
            aria-labelledby={codeId(row)}
            value={row.stage}
            onChange={(next) => {
              const stage = STAGES.find((s) => s === next);
              if (stage !== undefined && stage !== row.stage && gate.edit.allowed) {
                change.reset();
                setPending({ zone: row, to: stage });
              }
            }}
            options={STAGES.map((stage) => ({ value: stage, label: stageName(stage) }))}
          />
        </fieldset>
      ),
    },
    {
      key: 'updated',
      header: m('col.updated'),
      hideBelow: 'lg',
      cell: (row) => (
        <span className={styles.stackTight}>
          <span translate="no">{format.date(row.updatedAt)}</span>
          {row.updatedBy === null ? null : (
            <span className={styles.meta} translate="no">
              {row.updatedBy}
            </span>
          )}
        </span>
      ),
    },
  ];

  const automatic = pending?.to === 'automatic';
  return (
    <Card padding="none">
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{m('stage.title')}</h3>
      </div>
      <DataTable pageSize={0} caption={m('stage.title')} columns={columns} rows={[...zones]} getRowId={(row) => row.id} rowLabel={(row) => row.name} />
      {gate.edit.reason === null ? null : (
        <div className={styles.cardBody}>
          <Reason>{gate.edit.reason}</Reason>
        </div>
      )}
      <ReasonModal
        open={pending !== null}
        onClose={() => {
          setPending(null);
          change.reset();
        }}
        onConfirm={(reason) => pending !== null && change.run({ zoneId: pending.zone.id, stage: pending.to, reason })}
        title={pending === null ? '' : m('m.stage', { zone: pending.zone.code, stage: stageName(pending.to) })}
        description={pending === null ? undefined : `${pending.zone.code}: ${stageName(pending.zone.stage)} -> ${stageName(pending.to)}`}
        warning={
          automatic ? (
            <span className={styles.stackTight}>
              <span>{m('m.autoWarn')}</span>
              <span className={styles.inline}>
                <StubTag kind="notApplied" />
                <span>{m('m.guardrail')}</span>
              </span>
            </span>
          ) : undefined
        }
        required={false}
        pending={change.pending}
        error={<ActionError error={change.error} onDismiss={change.reset} />}
      />
    </Card>
  );
}
