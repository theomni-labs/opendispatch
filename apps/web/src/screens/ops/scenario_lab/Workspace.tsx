'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Card, SkeletonText, Textarea } from '@opendispatch/ui';
import { Lock, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { AnswerMeta } from '@/components/opendispatch/assistant/AnswerMeta';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { draftScenarioAction } from './actions';
import { Editor, type EditorProps } from './Editor';
import styles from './ScenarioLab.module.css';
import type { ScenarioDraftResult, ScenarioFormValues } from './types';

// Describe the scenario + editor

const MAX_CHARS = 500;

export interface WorkspaceProps extends EditorProps {
  readonly editorKey: string;
  /** Null: the describe card is hidden. */
  readonly assist: { readonly configured: boolean; readonly allowed: boolean } | null;
}

export function Workspace({ editorKey, assist, ...editor }: WorkspaceProps) {
  const [draft, setDraft] = useState<{ readonly form: ScenarioFormValues; readonly n: number } | null>(null);
  return (
    <>
      {assist === null ? null : <DescribeCard assist={assist} canEdit={editor.canEdit} onDraft={(form) => setDraft((prev) => ({ form, n: (prev?.n ?? 0) + 1 }))} />}
      {draft === null ? (
        <Editor key={editorKey} {...editor} />
      ) : (
        <Editor key={`${editorKey}:ai${String(draft.n)}`} {...editor} openId={null} form={draft.form} status="draft" lastRunLabel={null} initialDirty />
      )}
    </>
  );
}

function DescribeCard({ assist, canEdit, onDraft }: { assist: NonNullable<WorkspaceProps['assist']>; canEdit: boolean; onDraft: (form: ScenarioFormValues) => void }) {
  const m = useTranslations('ops.scenario_lab');
  const t = useTranslations();
  const locale = useLocale();
  const fieldId = useId();
  const [text, setText] = useState('');
  const [last, setLast] = useState<ScenarioDraftResult | null>(null);
  const draft = useAdminAction(draftScenarioAction, {
    quiet: true,
    onSuccess: (result) => {
      setLast(result);
      onDraft(result.form);
    },
  });
  const reason = !canEdit || !assist.allowed ? t('opendispatch.gate.viewOnly') : assist.configured ? null : t('opendispatch.assistant.off');
  const blocked = reason ?? (text.trim() === '' ? m('ai.needText') : null);
  const run = () => {
    if (blocked !== null) return;
    setLast(null);
    draft.run({ text: text.trim(), locale });
  };

  return (
    <Card padding="md">
      <div className={styles.aiCard} data-assistant="scenario-draft">
        <div className={styles.aiHead}>
          <Sparkles aria-hidden="true" className={styles.aiIcon} />
          <h2 className={styles.cardTitle} id={fieldId}>
            {m('ai.title')}
          </h2>
        </div>
        <Textarea aria-labelledby={fieldId} rows={2} maxLength={MAX_CHARS} value={text} placeholder={m('ai.placeholder')} disabled={!canEdit} onChange={(event) => setText(event.target.value)} />
        <div className={styles.aiActions}>
          {reason === null ? null : <Reason icon={<Lock />}>{reason}</Reason>}
          <ReasonHint reason={blocked} visible={false}>
            <Button variant="secondary" startIcon={<Sparkles />} loading={draft.pending} onClick={run}>
              {m('ai.draft')}
            </Button>
          </ReasonHint>
        </div>
        {draft.pending ? (
          <div aria-busy="true">
            <SkeletonText lines={2} announce />
          </div>
        ) : null}
        <ActionError error={draft.error} onDismiss={draft.reset} />
        {last === null || draft.pending || draft.error !== null ? null : (
          <div className={styles.aiDone} aria-live="polite">
            <div className={styles.aiMeta}>
              <AnswerMeta provider={last.provider} model={last.model} durationMs={last.duration_ms} illustrative={false} />
              <span className={styles.lastRun}>{m('ai.applied')}</span>
            </div>
            {last.unmapped.length === 0 ? null : (
              <Alert tone="warning" title={m('ai.unmapped')}>
                <ul className={styles.aiList}>
                  {last.unmapped.map((phrase, index) => (
                    <li key={index}>
                      <bdi>{phrase}</bdi>
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
