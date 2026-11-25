'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, EmptyState, StatusPill, Tag, useFormat, type Tone } from '@opendispatch/ui';
import { Check, Inbox, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import type { SortParam } from '@/components/opendispatch/patterns/search-params';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { DecisionDialog } from './DecisionDialog';
import { OUTCOME_COLOR, type ApprovalRow, type Outcome, type RuleRow } from './types';
import styles from './ClassificationRules.module.css';

// The tables of the Classification Rules screen (client files: the design system's DataTable takes functions, so the Server
// Component hands these plain data, and client-boundary.md). A row opens the rule's drawer through the address
// (`?rule=<code>`, a push, so Back closes it). Approve and Reject on an Approvals row open the decision dialog; whether the person
// may approve was decided on the server and arrives as `denial` (the data layer refuses again).

export const STATUS_TONE: Readonly<Record<string, Tone>> = { draft: 'warning', submitted: 'info', active: 'success', rejected: 'danger', retired: 'neutral', superseded: 'neutral', pending: 'info', approved: 'success', cancelled: 'neutral' };

export function OutcomeTag({ outcome }: { outcome: Outcome }) {
  const m = useTranslations('admin.classification_rules');
  return <Tag color={OUTCOME_COLOR[outcome]}>{m(`out.${outcome}`)}</Tag>;
}

/** A rule's name: Arabic when it has one, else English marked as English. */
export function RuleName({ name, nameAr, className }: { name: string; nameAr: string | null; className?: string | undefined }) {
  const locale = useLocale();
  if (locale === 'ar' && nameAr !== null && nameAr.trim() !== '') {
    return (
      <span className={className} lang="ar" translate="no">
        {nameAr}
      </span>
    );
  }
  return (
    <span className={className} lang="en" translate="no">
      {name}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const m = useTranslations('admin.classification_rules');
  return <StatusPill status={m(`st.${status}`)} tone={STATUS_TONE[status] ?? 'neutral'} size="sm" />;
}

// ---------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------

export interface RulesTableProps {
  readonly rows: readonly RuleRow[];
  readonly caption: string;
  readonly emptyState: ReactNode;
  readonly sort?: SortParam | undefined;
  readonly page?: number | undefined;
}

export function RulesTable({ rows, caption, emptyState, sort, page }: RulesTableProps) {
  const m = useTranslations('admin.classification_rules');
  const t = useTranslations();
  const format = useFormat();
  const columns: AdminTableColumn[] = [
    { key: 'rule', header: m('col.rule'), sortable: true, width: '11rem' },
    { key: 'cond', header: m('col.cond'), hideBelow: 'md' },
    { key: 'outcome', header: m('col.outcome'), width: '9rem' },
    { key: 'status', header: t('common.status'), sortable: true, width: '7rem' },
    { key: 'version', header: m('col.version'), width: '4.5rem' },
    { key: 'eff', header: m('col.eff'), hideBelow: 'lg', sortable: true, width: '9rem' },
  ];
  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: row.code,
    label: row.code,
    sort: { rule: row.code, status: row.current.status, eff: row.current.effectiveFrom ?? '' },
    cells: {
      rule: (
        <>
          <span className={styles.cellMain} translate="no">
            {row.code}
          </span>
          <RuleName className={styles.cellSub} name={row.name} nameAr={row.nameAr} />
        </>
      ),
      cond: (
        <span className={styles.cond} translate="no">
          {row.current.conditionText}
        </span>
      ),
      outcome: <OutcomeTag outcome={row.current.outcome} />,
      status: <StatusBadge status={row.current.status} />,
      version: (
        <span className={styles.versionCell}>
          <span>{m('v.label', { n: row.current.version })}</span>
          {row.next === null ? null : (
            <Badge size="sm" tone="warning">
              {m('v.next', { n: row.next })}
            </Badge>
          )}
        </span>
      ),
      eff: row.current.effectiveFrom === null ? <span className={styles.muted}>{m('eff.none')}</span> : format.date(row.current.effectiveFrom),
    },
  }));
  return <AdminTable caption={caption} columns={columns} rows={tableRows} rowParam="rule" emptyState={emptyState} sort={sort} page={page} />;
}

// ---------------------------------------------------------------------------------------------
// The approvals
// ---------------------------------------------------------------------------------------------

export interface ApprovalsTableProps {
  readonly rows: readonly ApprovalRow[];
  readonly caption: string;
}

/** Why Approve and Reject are unavailable, in the reader's language. */
export function useDenialReason(denial: 'role' | 'own' | null): string | null {
  const m = useTranslations('admin.classification_rules');
  return denial === 'own' ? m('self.reason') : denial === 'role' ? m('reason.approver') : null;
}

function DecisionButtons({ row, onDecide }: { row: ApprovalRow; onDecide: (kind: 'approve' | 'reject') => void }) {
  const t = useTranslations();
  const allowed = row.denial === null;
  const reason = useDenialReason(row.denial);
  return (
    <span className={styles.rowActions}>
      <ReasonHint reason={reason} visible={false}>
        <Button variant="secondary" size="sm" startIcon={<X />} onClick={() => allowed && onDecide('reject')}>
          {t('common.reject')}
        </Button>
      </ReasonHint>
      <ReasonHint reason={reason} visible={false}>
        <Button variant="primary" size="sm" startIcon={<Check />} onClick={() => allowed && onDecide('approve')}>
          {t('common.approve')}
        </Button>
      </ReasonHint>
    </span>
  );
}

export function ApprovalsTable({ rows, caption }: ApprovalsTableProps) {
  const m = useTranslations('admin.classification_rules');
  const t = useTranslations();
  const format = useFormat();
  const url = useUrlState();
  const [deciding, setDeciding] = useState<{ kind: 'approve' | 'reject'; code: string; version: number } | null>(null);

  const columns: AdminTableColumn[] = [
    { key: 'rule', header: m('col.rule') },
    { key: 'change', header: m('col.change'), hideBelow: 'md' },
    { key: 'submitted', header: m('col.submitted') },
    { key: 'status', header: t('common.status') },
    { key: 'by', header: m('col.by'), hideBelow: 'lg' },
    { key: 'actions', header: '', align: 'end' },
  ];
  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: row.id,
    label: row.code,
    href: url.hrefFor({ rule: row.code, version: String(row.version) }, { keepPage: true }),
    cells: {
      rule: (
        <>
          <span className={styles.cellMain} translate="no">
            {row.code}
          </span>
          <span className={styles.cellSub}>{m('v.label', { n: row.version })}</span>
        </>
      ),
      change: (
        <span className={styles.change} lang="en" dir="ltr" translate="no">
          {row.summary}
        </span>
      ),
      submitted: format.date(row.requestedAt),
      status: <StatusBadge status={row.status} />,
      by: row.decidedBy === null ? <span className={styles.muted}>-</span> : <span translate="no">{row.decidedBy}</span>,
      actions: row.status === 'pending' ? <DecisionButtons row={row} onDecide={(kind) => setDeciding({ kind, code: row.code, version: row.version })} /> : null,
    },
  }));

  return (
    <>
      <AdminTable caption={caption} columns={columns} rows={tableRows} rowParam="rule" emptyState={<EmptyState compact icon={<Inbox />} title={m('appr.empty')} />} />
      <DecisionDialog open={deciding !== null} kind={deciding?.kind ?? 'approve'} code={deciding?.code ?? ''} version={deciding?.version ?? 1} onClose={() => setDeciding(null)} onDone={() => setDeciding(null)} />
    </>
  );
}
