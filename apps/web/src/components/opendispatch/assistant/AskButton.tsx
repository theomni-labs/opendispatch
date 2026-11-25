'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Drawer, Field, Textarea } from '@opendispatch/ui';
import { Check, Lock, Send, Sparkles, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { AnswerView } from './types';
import { ActionError } from '../patterns/ActionError';
import { useAdminAction } from '../patterns/useAdminAction';
import { Reason } from '../ReasonHint';
import type { ActionResult } from '@/lib/actions/types';
import { AnswerMeta } from './AnswerMeta';
import { AnswerText } from './AnswerText';
import styles from './Assistant.module.css';

// Ask the system: top bar, Ops only

const MAX_CALLS = 5;
const MAX_CHARS = 500;

export interface AskButtonProps {
  /** The server action, passed in by the shell. */
  readonly action: (input: { question: string; locale: string }) => Promise<ActionResult<AnswerView>>;
  readonly configured: boolean;
}

export function AskButton({ action, configured }: AskButtonProps) {
  const t = useTranslations('opendispatch.assistant');
  const locale = useLocale();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AnswerView | null>(null);
  const ask = useAdminAction(action, { quiet: true, onSuccess: setAnswer });
  const text = question.trim();
  const send = () => {
    if (!configured || text === '') return;
    setAnswer(null);
    ask.run({ question: text, locale });
  };

  return (
    <>
      <Button variant="ghost" size="sm" startIcon={<Sparkles />} onClick={() => setOpen(true)} data-assistant="ask">
        <span className={styles.askLabel}>{t('ask')}</span>
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t('drawerTitle')}
        footer={
          <div className={styles.footer}>
            {configured ? null : <Reason icon={<Lock />}>{t('off')}</Reason>}
            <Button variant="primary" startIcon={<Send />} loading={ask.pending} aria-disabled={!configured || text === '' ? true : undefined} onClick={send}>
              {t('send')}
            </Button>
          </div>
        }
      >
        <div className={styles.drawerBody}>
          <Field label={t('question')} htmlFor={fieldId}>
            <Textarea
              id={fieldId}
              rows={3}
              maxLength={MAX_CHARS}
              value={question}
              data-autofocus
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send();
              }}
            />
          </Field>
          {ask.pending ? <p className={styles.muted} aria-live="polite">{t('working')}</p> : null}
          <ActionError error={ask.error} onDismiss={ask.reset} />
          {answer === null ? null : (
            <div className={styles.answer} aria-live="polite" data-assistant="answer">
              {answer.refused ? <Alert tone="info">{t('refused')}</Alert> : null}
              {answer.capped ? <Alert tone="warning">{t('capped', { max: MAX_CALLS })}</Alert> : null}
              {answer.answer === '' ? null : <AnswerText text={answer.answer} />}
              <AnswerMeta provider={answer.provider} model={answer.model} durationMs={answer.duration_ms} />
              {answer.tool_calls.length === 0 ? null : (
                <div className={styles.calls}>
                  <span className={styles.label}>{t('lookups', { n: answer.tool_calls.length, max: MAX_CALLS })}</span>
                  <ul className={styles.callList} role="list">
                    {answer.tool_calls.map((call, index) => (
                      <li key={`${call.name}-${index}`} className={styles.call} title={JSON.stringify(call.input)}>
                        {call.ok ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
                        <bdi translate="no" dir="ltr">
                          {call.name}
                        </bdi>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Drawer>
    </>
  );
}
