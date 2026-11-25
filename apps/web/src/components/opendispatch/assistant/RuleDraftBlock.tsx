'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Field, Textarea } from '@opendispatch/ui';
import { Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { ActionResult } from '@/lib/actions/types';
import { ActionError } from '../patterns/ActionError';
import { useAdminAction } from '../patterns/useAdminAction';
import { ReasonHint } from '../ReasonHint';
import { AnswerMeta } from './AnswerMeta';
import styles from './Assistant.module.css';
import type { RuleDraftView } from './types';

// Plain-language rule drafting

export interface RuleDraftBlockProps {
  /** The screen's server action. */
  readonly action: (input: { text: string; locale: string }) => Promise<ActionResult<RuleDraftView>>;
  readonly configured: boolean;
  /** The edit gate's reason, when the role may not edit. */
  readonly editReason: string | null;
  readonly onDraft: (draft: RuleDraftView['draft']) => void;
}

export function RuleDraftBlock({ action, configured, editReason, onDraft }: RuleDraftBlockProps) {
  const t = useTranslations('opendispatch.assistant');
  const locale = useLocale();
  const fieldId = useId();
  const [text, setText] = useState('');
  const [last, setLast] = useState<RuleDraftView | null>(null);
  const draft = useAdminAction(action, {
    quiet: true,
    onSuccess: (result) => {
      setLast(result);
      onDraft(result.draft);
    },
  });
  const reason = editReason ?? (configured ? null : t('off'));
  const run = () => reason === null && text.trim() !== '' && draft.run({ text: text.trim(), locale });

  return (
    <div className={styles.draftBox} data-assistant="rule-draft">
      <Field label={t('draftLabel')} htmlFor={fieldId}>
        <Textarea id={fieldId} rows={2} maxLength={500} value={text} onChange={(event) => setText(event.target.value)} />
      </Field>
      <div className={styles.draftActions}>
        <ReasonHint reason={reason}>
          <Button variant="secondary" startIcon={<Sparkles />} loading={draft.pending} onClick={run}>
            {t('draft')}
          </Button>
        </ReasonHint>
      </div>
      <ActionError error={draft.error} onDismiss={draft.reset} />
      {last === null || draft.error !== null ? null : (
        <div className={styles.draftNote} aria-live="polite">
          <span>{t('draftApplied')}</span>
          <AnswerMeta provider={last.provider} model={last.model} durationMs={last.duration_ms} illustrative={false} />
        </div>
      )}
      {last === null || draft.error !== null || (last.unmapped ?? []).length === 0 ? null : (
        <Alert tone="warning" title={t('unmappedTitle')}>
          <span>{t('unmappedHint')}</span>
          <ul className={styles.list}>
            {(last.unmapped ?? []).map((phrase, index) => (
              <li key={index}>
                <bdi>{phrase}</bdi>
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
