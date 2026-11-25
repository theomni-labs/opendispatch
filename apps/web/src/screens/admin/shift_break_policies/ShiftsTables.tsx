'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, SegmentedControl, StatusPill, Tag, useToast } from '@opendispatch/ui';
import { Ban, Check, Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import type { SortParam } from '@/components/opendispatch/patterns/search-params';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveCsv } from '@/lib/export/download';
import { setPatternsStatus } from './actions';
import { patternName, type BreakRow, type HoursMode, type Hours, type PatternRow } from './types';
import styles from './ShiftBreakPolicies.module.css';

// The table of shift patterns and the week's hours switch (client files: the design system's DataTable takes functions, so the
// Server Component hands these plain data, ). A row opens its drawer through the address (`?pattern=<id>`, a push, so
// Back closes it). Nothing here reads a context or the caller's role.

export function Range({ hours }: { hours: Hours | null }) {
  const t = useTranslations();
  return hours === null ? <span className={styles.muted}>{t('common.none')}</span> : <bdi dir="ltr">{`${hours.start} - ${hours.end}`}</bdi>;
}

export function KindTag({ kind }: { kind: 'field' | 'remote' }) {
  const m = useTranslations('admin.shift_break_policies');
  return <Tag color={kind === 'field' ? 'geekblue' : 'green'}>{m(`kind.${kind}`)}</Tag>;
}

export function StatusBadge({ status }: { status: 'active' | 'draft' }) {
  const m = useTranslations('admin.shift_break_policies');
  return <StatusPill status={m(`status.${status}`)} tone={status === 'active' ? 'success' : 'warning'} size="sm" />;
}

export interface PatternsTableProps {
  readonly rows: readonly PatternRow[];
  readonly breaks: readonly BreakRow[];
  readonly caption: string;
  readonly canEdit: boolean;
  readonly emptyState: ReactNode;
  readonly exportHeader: readonly string[];
  readonly exportRows: readonly (readonly string[])[];
  readonly exportFilename: string;
  readonly sort?: SortParam | undefined;
  readonly page?: number | undefined;
}

export function PatternsTable({ rows, breaks, caption, canEdit, emptyState, exportHeader, exportRows, exportFilename, sort, page }: PatternsTableProps) {
  const m = useTranslations('admin.shift_break_policies');
  const t = useTranslations();
  const locale = useLocale();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const bulk = useAdminAction(setPatternsStatus, {
    successTitle: (result) => m('toast.bulk', { n: result.changed, status: m(`status.${result.status === 'active' ? 'active' : 'draft'}`) }),
    successDescription: (result) =>
      result.failed === 0 ? undefined : (
        <span lang="en" dir="ltr" translate="no">
          {result.firstProblem}
        </span>
      ),
    failureToast: true,
  });

  const columns: AdminTableColumn[] = [
    { key: 'pattern', header: m('col.pattern'), sortable: true },
    { key: 'kind', header: m('col.kind'), sortable: true, width: '6rem' },
    { key: 'normal', header: m('col.normal'), width: '10rem' },
    { key: 'ramadan', header: m('col.ramadan'), width: '10rem' },
    { key: 'break', header: m('col.break'), hideBelow: 'md' },
    { key: 'status', header: t('common.status'), sortable: true },
  ];
  const tableRows: AdminTableRow[] = rows.map((row) => {
    const rule = breaks.find((b) => b.id === row.breakRuleId);
    const name = patternName(row, locale);
    return {
      id: row.id,
      label: name,
      tone: row.status === 'draft' ? 'warning' : undefined,
      sort: { pattern: name, kind: row.kind, status: row.status },
      cells: {
        pattern: (
          <>
            <span className={styles.cellMain} translate="no">
              {name}
            </span>
            <span className={styles.cellSub} translate="no">
              {row.code}
            </span>
          </>
        ),
        kind: <KindTag kind={row.kind} />,
        normal: <Range hours={row.normal} />,
        ramadan: <Range hours={row.ramadan} />,
        break: rule === undefined ? <span className={styles.muted}>-</span> : m('brk.short', { m: rule.minutes, h: rule.afterHours }),
        status: <StatusBadge status={row.status} />,
      },
    };
  });

  function setStatus(ids: string[], status: 'active' | 'draft', clear: () => void) {
    if (!gate.edit.allowed) return;
    const targets = ids.filter((id) => rows.find((r) => r.id === id)?.status !== status);
    if (targets.length === 0) return;
    bulk.run({ targetIds: targets, status });
    clear();
  }

  function exportSelected(ids: string[]) {
    const chosen = new Set(ids);
    saveCsv(exportFilename, { header: [...exportHeader], rows: exportRows.filter((_, index) => chosen.has(rows[index]?.id ?? '')).map((row) => [...row]) });
    toast({ title: m('toast.export'), tone: 'info' });
  }

  return (
    <AdminTable
      caption={caption}
      columns={columns}
      rows={tableRows}
      rowParam="pattern"
      emptyState={emptyState}
      selectable
      sort={sort}
      page={page}
      bulkActions={(ids, clear) => (
        <>
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button variant="secondary" size="sm" startIcon={<Check />} loading={bulk.pending} onClick={() => setStatus(ids, 'active', clear)}>
              {m('bulk.active')}
            </Button>
          </ReasonHint>
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button variant="secondary" size="sm" startIcon={<Ban />} loading={bulk.pending} onClick={() => setStatus(ids, 'draft', clear)}>
              {m('bulk.draft')}
            </Button>
          </ReasonHint>
          <Button variant="secondary" size="sm" startIcon={<Download />} onClick={() => exportSelected(ids)}>
            {t('common.export')}
          </Button>
        </>
      )}
    />
  );
}

/** Normal or Ramadan hours for the week strip: the choice is `?hours=`, so the server draws the ribbons for it. */
export function HoursSwitch({ mode }: { mode: HoursMode }) {
  const m = useTranslations('admin.shift_break_policies');
  const url = useUrlState();
  return (
    <SegmentedControl
      size="sm"
      ariaLabel={m('mode.label')}
      value={mode}
      options={[
        { value: 'normal', label: m('mode.normal') },
        { value: 'ramadan', label: m('mode.ramadan') },
      ]}
      onChange={(next) => url.update({ hours: next === 'ramadan' ? 'ramadan' : null }, { history: 'replace', keepPage: true })}
    />
  );
}
