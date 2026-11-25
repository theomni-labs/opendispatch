'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, EmptyState, SegmentedControl } from '@opendispatch/ui';
import { Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Qualifier } from '@/components/opendispatch/Qualifier';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { runClassifierAction } from './actions';
import styles from './ClassificationRules.module.css';
import type { AiReviewRow, AiReviewView } from './types';

// AI review tab

export interface AiReviewProps {
  readonly view: AiReviewView;
  readonly canEdit: boolean;
  /** False: the assistant is off. */
  readonly configured: boolean;
}

function Handling({ handling }: { readonly handling: AiReviewRow['ai']['handling'] }) {
  const t = useTranslations();
  return (
    <span>
      {handling === 'field' ? t('opendispatch.caseAi.handlingField') : t('opendispatch.caseAi.handlingRemote')} <Qualifier />
    </span>
  );
}

const SEV = { minor: 'sevMinor', moderate: 'sevModerate', severe: 'sevSevere' } as const;

export function AiReview({ view, canEdit, configured }: AiReviewProps) {
  const m = useTranslations('admin.classification_rules');
  const t = useTranslations();
  const locale = useLocale();
  const url = useUrlState();
  const run = useAdminAction(runClassifierAction, {
    successTitle: (r) => m('ai.runDone', { n: r.classified }),
    successDescription: (r) => (r.stopped_reason === null ? t('opendispatch.caseAi.toastDesc') : <span lang="en" dir="ltr">{m('ai.runStopped', { reason: r.stopped_reason })}</span>),
  });
  const runReason = !canEdit ? t('opendispatch.gate.viewOnly') : !configured ? t('opendispatch.assistant.off') : null;
  const pct = (n: number | null) => (n === null ? '—' : `${n}%`);

  const columns: AdminTableColumn[] = [
    { key: 'case', header: m('ai.col.case') },
    { key: 'ai', header: m('ai.col.ai') },
    { key: 'rules', header: m('ai.col.rules') },
    { key: 'confidence', header: m('ai.col.confidence'), align: 'end', hideBelow: 'md' },
    { key: 'why', header: m('ai.col.why'), hideBelow: 'lg' },
    { key: 'review', header: m('ai.col.review') },
  ];
  const rows: AdminTableRow[] = view.rows.map((r) => ({
    id: r.id,
    label: r.caseNumber,
    tone: r.agrees ? undefined : 'warning',
    cells: {
      case: (
        <span className={styles.cellMain} translate="no">
          {r.caseNumber}
        </span>
      ),
      ai: (
        <span className={styles.cellStack}>
          <Handling handling={r.ai.handling} />
          <span className={styles.cellSub}>{t(`opendispatch.caseAi.${SEV[r.ai.severity]}`)}</span>
        </span>
      ),
      rules: (
        <span className={styles.cellStack}>
          <Handling handling={r.rule.handling} />
          <span className={styles.cellSub}>{r.rule.ruleName === null ? t('opendispatch.caseAi.ruleDefault') : <bdi translate="no">{r.rule.ruleName}</bdi>}</span>
        </span>
      ),
      confidence: (
        <bdi translate="no" dir="ltr">
          {`${r.pct}%`}
        </bdi>
      ),
      why: <span className={styles.wrap}>{r.reason}</span>,
      review: r.review === null ? <span className={styles.muted}>{m('ai.rv.none')}</span> : <Badge size="sm" tone={r.review === 'accepted' ? 'success' : 'neutral'}>{m(`ai.rv.${r.review}`)}</Badge>,
    },
  }));

  return (
    <div className={styles.stack} data-panel="ai">
      <StatStrip
        items={[
          { label: m('ai.st.compared'), value: view.compared },
          { label: m('ai.st.handling'), value: pct(view.handlingPct), hint: <IllustrativeLabel /> },
          { label: m('ai.st.severity'), value: pct(view.severityPct), hint: <IllustrativeLabel /> },
          { label: m('ai.st.reviewed'), value: view.reviewed },
        ]}
      />
      <Card padding="none">
        <div className={styles.aiHead}>
          <h2 className={styles.aiTitle}>{m('ai.title')}</h2>
          <SegmentedControl
            size="sm"
            ariaLabel={m('ai.only.label')}
            value={view.only}
            onChange={(v) => url.update({ only: v === 'all' ? 'all' : null }, { keepPage: true })}
            options={[
              { value: 'disagreements', label: m('ai.only.disagreements') },
              { value: 'all', label: m('ai.only.all') },
            ]}
          />
          <ReasonHint reason={runReason}>
            <Button variant="secondary" size="sm" startIcon={<Sparkles />} loading={run.pending} onClick={() => runReason === null && run.run({ locale })}>
              {m('ai.run')}
            </Button>
          </ReasonHint>
        </div>
        <ActionError error={run.error} onDismiss={run.reset} />
        <AdminTable columns={columns} rows={rows} caption={m('tab.ai')} rowParam={false} emptyState={<EmptyState compact icon={<Sparkles />} title={m('ai.empty')} />} />
        <div className={styles.aiFoot}>
          <span>{m('ai.summary', { n: view.rows.length, total: view.compared })}</span>
          {view.provider === null ? null : (
            <bdi className={styles.muted} translate="no" dir="ltr">
              {view.provider}
            </bdi>
          )}
        </div>
      </Card>
    </div>
  );
}
