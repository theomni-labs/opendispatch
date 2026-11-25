'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, DescriptionList, StatusPill } from '@opendispatch/ui';
import { Check, FileText, ImageOff, RefreshCw, Sparkles, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '../patterns/ActionError';
import { useAdminAction } from '../patterns/useAdminAction';
import { IllustrativeLabel } from '../IllustrativeLabel';
import { Qualifier } from '../Qualifier';
import { ReasonHint } from '../ReasonHint';
import type { ActionResult } from '@/lib/actions/types';
import { AnswerMeta } from './AnswerMeta';
import type { CaseSuggestionCardView, RuleLine, SuggestionView } from './caseSuggestion';
import styles from './CaseSuggestion.module.css';

// Suggested by AI

type SuggestFn = (input: { caseId: string; from: string; locale: string }) => Promise<ActionResult<SuggestionView>>;
type ReviewFn = (input: { caseId: string; from: string; decision: string; suggestedAt: string; locale: string }) => Promise<ActionResult<SuggestionView>>;

export interface CaseSuggestionCardProps {
  readonly view: CaseSuggestionCardView;
  readonly suggestAction: SuggestFn;
  readonly reviewAction: ReviewFn;
  /** False: the assistant is off; Suggest says why. */
  readonly configured: boolean;
  /** True: nothing leaves the install (local model). */
  readonly offline: boolean;
  /** Edit on the screen's module: may accept. */
  readonly canEdit: boolean;
}

function HandlingText({ handling }: { readonly handling: RuleLine['handling'] }) {
  const t = useTranslations('opendispatch.caseAi');
  return (
    <>
      {handling === 'field' ? t('handlingField') : t('handlingRemote')} <Qualifier />
    </>
  );
}

const SEVERITY_KEY = { minor: 'sevMinor', moderate: 'sevModerate', severe: 'sevSevere' } as const;
const METHOD_KEY = { photo: 'methodPhoto', video: 'methodVideo', in_person: 'methodInPerson' } as const;

export function RuleText({ rule }: { readonly rule: RuleLine }) {
  const t = useTranslations('opendispatch.caseAi');
  return (
    <span>
      <HandlingText handling={rule.handling} /> · {rule.ruleName === null ? t('ruleDefault') : <span translate="no">{t('rule', { name: rule.ruleName })}</span>}
    </span>
  );
}

export function CaseSuggestionCard({ view, suggestAction, reviewAction, configured, offline, canEdit }: CaseSuggestionCardProps) {
  const t = useTranslations('opendispatch.caseAi');
  const tg = useTranslations();
  const locale = useLocale();
  const [current, setCurrent] = useState<{ caseId: string; s: SuggestionView | null }>({ caseId: view.caseId, s: view.suggestion });
  const s = current.caseId === view.caseId ? (current.s ?? view.suggestion) : view.suggestion;
  if (current.caseId !== view.caseId) setCurrent({ caseId: view.caseId, s: view.suggestion });

  const suggest = useAdminAction(suggestAction, { quiet: true, onSuccess: (next) => setCurrent({ caseId: view.caseId, s: next }) });
  const review = useAdminAction(reviewAction, {
    successTitle: (next) => (next.review?.decision === 'accepted' ? t('toastAccepted') : t('toastRejected')),
    successDescription: t('toastDesc'),
    onSuccess: (next) => setCurrent({ caseId: view.caseId, s: next }),
  });

  const suggestReason = !configured ? tg('opendispatch.assistant.off') : view.narrative === null ? t('noDescription') : null;
  const reviewReason = canEdit ? null : tg('opendispatch.gate.viewOnly');
  const run = () => suggestReason === null && suggest.run({ caseId: view.caseId, from: view.from, locale });
  const decide = (decision: 'accepted' | 'rejected') => s !== null && reviewReason === null && review.run({ caseId: view.caseId, from: view.from, decision, suggestedAt: s.suggestedAt, locale });

  return (
    <Card padding="md" className={styles.card} data-assistant="case">
      <div className={styles.head}>
        <Sparkles className={styles.icon} aria-hidden="true" />
        <h3 className={styles.title}>{t('title')}</h3>
        <ReasonHint reason={suggestReason}>
          <Button variant={s === null ? 'secondary' : 'ghost'} size="sm" loading={suggest.pending} startIcon={s === null ? undefined : <RefreshCw />} onClick={run}>
            {s === null ? t('suggest') : t('again')}
          </Button>
        </ReasonHint>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>{t('description')}</span>
        {view.narrative === null ? (
          <span className={styles.muted}>
            <FileText aria-hidden="true" />
            {t('noDescription')}
          </span>
        ) : (
          <p className={styles.text} dir={view.narrativeDir}>
            {view.narrative}
          </p>
        )}
      </div>

      <div className={styles.block}>
        <span className={styles.label}>{t('photos')}</span>
        <span className={styles.muted}>
          <ImageOff aria-hidden="true" />
          {view.photos === 0 ? t('noPhotos') : t('photosCount', { n: view.photos })}
        </span>
        {view.photos > 0 && (offline || s?.textOnly === true) ? <span className={styles.muted}>{t('textOnly')}</span> : null}
      </div>

      {suggest.pending ? (
        <p className={styles.muted} aria-live="polite">
          {t('working')}
        </p>
      ) : null}
      <ActionError error={suggest.error} onDismiss={suggest.reset} />

      {s === null ? null : (
        <div className={styles.result} aria-live="polite">
          <DescriptionList
            dense
            columns={2}
            items={[
              { label: t('handling'), value: <HandlingText handling={s.handling} /> },
              { label: t('severity'), value: t(SEVERITY_KEY[s.severity]) },
              { label: t('injury'), value: s.injury ? t('yes') : t('no') },
              { label: t('method'), value: t(METHOD_KEY[s.method]) },
              {
                label: t('confidence'),
                value: (
                  <span className={styles.inline}>
                    <bdi translate="no" dir="ltr">{`${s.confidencePct}%`}</bdi>
                    <IllustrativeLabel />
                  </span>
                ),
              },
            ]}
          />
          <div className={styles.block}>
            <span className={styles.label}>{t('reason')}</span>
            <p className={styles.text} lang={s.locale} dir={s.locale === 'ar' ? 'rtl' : 'ltr'}>
              {s.reason} <q className={styles.quote}>{s.quote}</q>
            </p>
          </div>
          <div className={styles.inlineWrap}>
            <span className={styles.label}>{t('rules')}</span>
            <RuleText rule={s.rule} />
            <StatusPill status={s.agrees ? t('agrees') : t('differs')} tone={s.agrees ? 'success' : 'warning'} size="sm" />
          </div>
          <AnswerMeta provider={s.provider} model={s.model} durationMs={s.durationMs} illustrative={false} />
          {s.review === null ? (
            <div className={styles.inlineWrap}>
              <ReasonHint reason={reviewReason} visible={false}>
                <Button variant="secondary" size="sm" startIcon={<Check />} loading={review.pending} onClick={() => decide('accepted')}>
                  {t('accept')}
                </Button>
              </ReasonHint>
              <ReasonHint reason={reviewReason}>
                <Button variant="ghost" size="sm" startIcon={<X />} disabled={review.pending} onClick={() => decide('rejected')}>
                  {t('reject')}
                </Button>
              </ReasonHint>
              <span className={styles.muted}>{t('unchanged')}</span>
            </div>
          ) : (
            <div className={styles.inlineWrap}>
              <Badge size="sm" tone={s.review.decision === 'accepted' ? 'success' : 'neutral'}>
                {s.review.decision === 'accepted' ? t('accepted', { name: s.review.by }) : t('rejected', { name: s.review.by })}
              </Badge>
              <span className={styles.muted}>{t('unchanged')}</span>
            </div>
          )}
          <ActionError error={review.error} onDismiss={review.reset} />
        </div>
      )}
    </Card>
  );
}
