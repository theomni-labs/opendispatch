'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Card } from '@opendispatch/ui';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { AnswerMeta } from '@/components/opendispatch/assistant/AnswerMeta';
import { CopyButton } from '@/components/opendispatch/patterns/CopyButton';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { explainIssues } from './actions';
import type { ImportHelp, IssuesHelpView } from './types';
import styles from './ImportHelp.module.css';

// Explain these issues

export interface IssuesHelpProps {
  readonly jobId: string | null;
  readonly help: ImportHelp;
  /** The job has no issues to explain. */
  readonly empty: boolean;
}

export function IssuesHelp({ jobId, help, empty }: IssuesHelpProps) {
  const m = useTranslations('admin.data_import_quality');
  const a = useTranslations('opendispatch.assistant');
  const locale = useLocale();
  const [result, setResult] = useState<{ job: string; view: IssuesHelpView } | null>(null);
  const run = useAdminAction(explainIssues, { quiet: true, onSuccess: (view) => jobId !== null && setResult({ job: jobId, view }) });
  const view = result !== null && result.job === jobId ? result.view : null;
  const reason = !help.configured ? a('off') : jobId === null || empty ? m('ai.noIssues') : null;
  const go = () => reason === null && jobId !== null && run.run({ jobId, locale });
  const rulesText = view === null ? '' : view.rules.map((r) => `- ${r}`).join('\n');

  return (
    <Card padding="md" data-assistant="import-issues">
      <div className={styles.card}>
        <div className={styles.head}>
          <Sparkles className={styles.icon} aria-hidden="true" />
          <h2 className={styles.title}>{m('ai.explainTitle')}</h2>
          <ReasonHint reason={reason}>
            <Button variant={view === null ? 'secondary' : 'ghost'} size="sm" loading={run.pending} startIcon={view === null ? undefined : <RefreshCw />} onClick={go}>
              {view === null ? a('explain') : a('again')}
            </Button>
          </ReasonHint>
        </div>
        {run.pending && view === null ? <p className={styles.muted} aria-live="polite">{a('working')}</p> : null}
        <ActionError error={run.error} onDismiss={run.reset} />
        {view === null ? null : (
          <div className={styles.answer} aria-live="polite">
            {view.fallback ? <Alert tone="info">{m('ai.fallback')}</Alert> : null}
            <p className={styles.text}>{view.text}</p>
            {view.fixes.length === 0 ? null : (
              <div className={styles.block}>
                <span className={styles.label}>{m('ai.fixes')}</span>
                <ul className={styles.list}>
                  {view.fixes.map((fix, i) => (
                    <li key={i}>{fix}</li>
                  ))}
                </ul>
              </div>
            )}
            {view.fallback ? null : (
              <div className={styles.box}>
                <div className={styles.boxHead}>
                  <span className={styles.label}>{m('ai.note')}</span>
                  <CopyButton value={view.ownerNote} label={m('ai.copy')} showLabel description={m('ai.note')} />
                </div>
                <p className={styles.text}>{view.ownerNote}</p>
              </div>
            )}
            {view.rules.length === 0 ? null : (
              <div className={styles.box}>
                <div className={styles.boxHead}>
                  <span className={styles.label}>{m('ai.rules')}</span>
                  <CopyButton value={rulesText} label={m('ai.copy')} showLabel description={m('ai.rules')} />
                </div>
                <ul className={styles.list}>
                  {view.rules.map((rule, i) => (
                    <li key={i}>{rule}</li>
                  ))}
                </ul>
              </div>
            )}
            <AnswerMeta provider={view.provider} model={view.model} durationMs={view.duration_ms} illustrative={false} />
            <details className={styles.sent}>
              <summary>{a('sent')}</summary>
              <code className={styles.code} dir="ltr" translate="no">
                {view.sent}
              </code>
            </details>
          </div>
        )}
      </div>
    </Card>
  );
}
