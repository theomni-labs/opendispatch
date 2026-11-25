'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card } from '@opendispatch/ui';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ExplanationView } from './types';
import { ActionError } from '../patterns/ActionError';
import { useAdminAction } from '../patterns/useAdminAction';
import { ReasonHint } from '../ReasonHint';
import type { ActionResult } from '@/lib/actions/types';
import { AnswerMeta } from './AnswerMeta';
import { AnswerText } from './AnswerText';
import styles from './Assistant.module.css';

// Explain this: one card, above the screen

export interface ExplainCardProps {
  /** The server action, passed in by the screen. */
  readonly action: (input: { target: string; zone_id?: string | undefined; date?: string | undefined; locale: string }) => Promise<ActionResult<ExplanationView>>;
  readonly target: 'forecast_explorer' | 'gap_surplus';
  readonly zoneId?: string | undefined;
  readonly date?: string | undefined;
  /** False: the assistant is off; the button says why. */
  readonly configured: boolean;
  /** The view has filters Explain cannot match. */
  readonly blockedReason?: string | undefined;
}

export function ExplainCard({ action, target, zoneId, date, configured, blockedReason }: ExplainCardProps) {
  const t = useTranslations('opendispatch.assistant');
  const locale = useLocale();
  const [result, setResult] = useState<ExplanationView | null>(null);
  const explain = useAdminAction(action, { quiet: true, onSuccess: setResult });
  const reason = configured ? (blockedReason ?? null) : t('off');
  const run = () => reason === null && explain.run({ target, zone_id: zoneId, date, locale });

  return (
    <Card padding="md" className={styles.card} data-assistant="explain">
      <div className={styles.head}>
        <Sparkles className={styles.icon} aria-hidden="true" />
        <h2 className={styles.title}>{t('explainTitle')}</h2>
        <ReasonHint reason={reason}>
          <Button variant={result === null ? 'secondary' : 'ghost'} size="sm" loading={explain.pending} startIcon={result === null ? undefined : <RefreshCw />} onClick={run}>
            {result === null ? t('explain') : t('again')}
          </Button>
        </ReasonHint>
      </div>
      {explain.pending && result === null ? <p className={styles.muted} aria-live="polite">{t('working')}</p> : null}
      <ActionError error={explain.error} onDismiss={explain.reset} />
      {result === null ? null : (
        <div className={styles.answer} aria-live="polite">
          <AnswerText text={result.text} />
          <AnswerMeta provider={result.provider} model={result.model} durationMs={result.duration_ms} />
          <details className={styles.sent}>
            <summary>{t('sent')}</summary>
            <code className={styles.code} dir="ltr" translate="no">
              {result.sent}
            </code>
          </details>
        </div>
      )}
    </Card>
  );
}
