'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, StatusPill, useToast } from '@opendispatch/ui';
import { time } from '@opendispatch/ui/format';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition, type ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { updateBreakSlotAction } from './actions';
import { nearestFreeSlot, type BreakPrayerPolicy, type PrayerMinute } from './types';
import type { BreakRowView } from './view';

// Conflicts tab, bulk Move to free slot

export interface ConflictsTableProps {
  readonly rows: readonly BreakRowView[];
  readonly date: string;
  readonly prayers: readonly PrayerMinute[];
  readonly policy: BreakPrayerPolicy;
  readonly caption: string;
  readonly emptyState: ReactNode;
  readonly disabledReason: string | null;
}

export function ConflictsTable({ rows, date, prayers, policy, caption, emptyState, disabledReason }: ConflictsTableProps) {
  const m = useTranslations('ops.break_planner');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();
  const [pending, startTransition] = useTransition();

  const byId = new Map(rows.map((r) => [r.assignmentId, r] as const));

  function fixSelected(ids: string[], clear: () => void) {
    if (disabledReason !== null) return;
    startTransition(async () => {
      let moved = 0;
      for (const id of ids) {
        const row = byId.get(id);
        if (row === undefined) continue;
        const target = nearestFreeSlot(row.startMin, row.durationMin, row.earliestMin, row.latestMin, prayers, policy);
        if (target === null || target === row.startMin) continue;
        // One audited write per row, in order
        const result = await updateBreakSlotAction({ rosterAssignmentId: id, date, startMin: target });
        if (result.ok) moved += 1;
      }
      clear();
      toast({ title: m('toast.fixed', { n: moved }), tone: moved > 0 ? 'success' : 'info' });
    });
  }

  const columns: AdminTableColumn[] = [
    { key: 'agent', header: t('common.agent') },
    { key: 'shift', header: m('col.shift'), hideBelow: 'md' },
    { key: 'break', header: m('col.break') },
    { key: 'prayer', header: m('col.prayer') },
    { key: 'overlap', header: m('col.overlap'), align: 'end' },
    { key: 'action', header: '', align: 'end' },
  ];

  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: row.assignmentId,
    label: row.agentName,
    cells: {
      agent: <span translate="no">{row.agentName}</span>,
      shift: <span translate="no">{row.shiftLabel}</span>,
      break: (
        <span dir="ltr" translate="no">
          {time(row.startMin)}–{time(row.endMin)}
        </span>
      ),
      prayer: row.prayerConflict === null ? '—' : <StatusPill status={m(`prayer.${row.prayerConflict}`)} tone="danger" size="sm" />,
      overlap: (
        <span translate="no">
          {row.overlapMinutes} {t('common.minShort')}
        </span>
      ),
      action: (
        <ReasonHint reason={disabledReason} visible={false}>
          <Button variant="secondary" size="sm" onClick={() => url.update({ adjust: row.assignmentId }, { keepPage: true, history: 'push' })}>
            {m('adjust')}
          </Button>
        </ReasonHint>
      ),
    },
  }));

  return (
    <AdminTable
      caption={caption}
      columns={columns}
      rows={tableRows}
      emptyState={emptyState}
      rowParam={false}
      selectable
      bulkActions={(ids, clear) => (
        <ReasonHint reason={disabledReason} visible={false}>
          <Button variant="primary" size="sm" startIcon={<Sparkles />} loading={pending} onClick={() => fixSelected(ids, clear)}>
            {m('fix')}
          </Button>
        </ReasonHint>
      )}
    />
  );
}
