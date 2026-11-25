'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, StatusPill, Tag, type MenuEntry, type Tone } from '@opendispatch/ui';
import { Copy, Ellipsis, Pencil, Trash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { deleteScenarioAction, deleteScenariosAction, duplicateScenarioAction } from './actions';
import { changeText } from './changes';
import styles from './ScenarioLab.module.css';
import type { ScenarioStatus } from './types';
import type { SavedRowView } from './view';

// Saved scenarios (#sc2-rows), with bulk Delete.

const STATUS_TONE: Readonly<Record<ScenarioStatus, Tone>> = { draft: 'neutral', running: 'warning', completed: 'success', failed: 'danger' };

export interface SavedScenariosTableProps {
  readonly rows: readonly SavedRowView[];
  readonly caption: string;
  readonly canEdit: boolean;
}

export function SavedScenariosTable({ rows, caption, canEdit }: SavedScenariosTableProps) {
  const m = useTranslations('ops.scenario_lab');
  const t = useTranslations();
  const url = useUrlState();

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [bulkIds, setBulkIds] = useState<{ ids: string[]; clear: () => void } | null>(null);
  const gate = useGate(canEdit ? 'edit' : 'view');
  const target = rows.find((r) => r.id === confirmId);

  const duplicate = useAdminAction(duplicateScenarioAction, {
    successTitle: m('toast.dup'),
    successDescription: (scenario) => scenario.name,
    onSuccess: (scenario) => url.update({ scenario: scenario.id, tpl: null }, { history: 'replace', keepPage: true }),
    // No form here to hold an inline Alert.
    failureToast: true,
  });

  const del = useAdminAction(deleteScenarioAction, {
    successTitle: m('toast.deleted'),
    successDescription: (result) => result.name,
    onSuccess: () => setConfirmId(null),
  });

  const bulkDel = useAdminAction(deleteScenariosAction, {
    successTitle: m('toast.deleted'),
    onSuccess: () => {
      bulkIds?.clear();
      setBulkIds(null);
    },
  });

  const columns: AdminTableColumn[] = [
    { key: 'name', header: m('col.name') },
    { key: 'zones', header: m('col.zones'), hideBelow: 'md' },
    { key: 'changes', header: m('col.changes'), hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
    { key: 'lastRun', header: m('col.lastRun'), hideBelow: 'md' },
    { key: 'actions', header: '', align: 'end' },
  ];

  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: row.id,
    label: row.name,
    tone: row.isOpen ? 'info' : undefined,
    cells: {
      name: (
        <span className={styles.cellMain}>
          <span translate="no">{row.name}</span>
          <span translate="no">{row.dateLabel}</span>
        </span>
      ),
      zones: (
        <span className={styles.zoneTags}>
          {row.zoneCodes.map((code) => (
            <Tag key={code} color="gray">
              {code}
            </Tag>
          ))}
        </span>
      ),
      changes: <span className={styles.changes}>{row.changes.length === 0 ? '—' : row.changes.map((part) => changeText(m, part)).join(', ')}</span>,
      status: <StatusPill status={m(`status.${row.status}`)} tone={STATUS_TONE[row.status]} size="sm" />,
      lastRun: row.lastRunLabel === null ? <span className={styles.readingPrompt}>{'—'}</span> : <span translate="no">{row.lastRunLabel}</span>,
      actions: (() => {
        const items: MenuEntry[] = [
          { label: m('open'), icon: <Pencil />, onSelect: () => url.update({ scenario: row.id, tpl: null }, { history: 'push', keepPage: true }) },
          ...(canEdit ? [] : [{ type: 'heading', label: t('opendispatch.gate.viewOnly') } as const]),
          { label: m('dup'), icon: <Copy />, disabled: !canEdit || duplicate.pending, onSelect: () => duplicate.run({ id: row.id }) },
          { label: m('delete'), icon: <Trash />, danger: true, disabled: !canEdit, onSelect: () => setConfirmId(row.id) },
        ];
        return (
          <Menu
            trigger={
              <Button variant="ghost" size="sm" aria-label={t('common.more')}>
                <Ellipsis aria-hidden="true" />
              </Button>
            }
            align="end"
            label={t('common.more')}
            items={items}
          />
        );
      })(),
    },
  }));

  return (
    <>
      <AdminTable
        columns={columns}
        rows={tableRows}
        caption={caption}
        rowParam="scenario"
        selectable
        bulkActions={(ids, clear) => (
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button variant="secondary" size="sm" startIcon={<Trash />} onClick={() => gate.edit.allowed && setBulkIds({ ids, clear })}>
              {m('delete')}
            </Button>
          </ReasonHint>
        )}
      />
      <ConfirmDialog
        open={bulkIds !== null}
        onClose={() => setBulkIds(null)}
        onConfirm={() => bulkIds !== null && bulkDel.run({ ids: bulkIds.ids })}
        title={m('deleteMany.title', { n: bulkIds?.ids.length ?? 0 })}
        description={m('deleteConfirm.desc')}
        confirmLabel={m('delete')}
        tone="danger"
        pending={bulkDel.pending}
        error={<ActionError error={bulkDel.error} onDismiss={bulkDel.reset} />}
      />
      <ConfirmDialog
        open={target !== undefined}
        onClose={() => setConfirmId(null)}
        onConfirm={() => target !== undefined && del.run({ id: target.id })}
        title={m('deleteConfirm.title', { name: target?.name ?? '' })}
        description={m('deleteConfirm.desc')}
        confirmLabel={m('delete')}
        tone="danger"
        pending={del.pending}
        error={<ActionError error={del.error} onDismiss={del.reset} />}
      />
    </>
  );
}
