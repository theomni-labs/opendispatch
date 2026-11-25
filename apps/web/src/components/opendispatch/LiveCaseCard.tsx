'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Avatar, Badge, Button, Tag, Tooltip, type Tone } from '@opendispatch/ui';
import { int } from '@opendispatch/ui/format';
import { ArrowLeftRight, Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { MouseEvent, ReactNode } from 'react';
import { cx } from './cx';
import { ReasonHint } from './ReasonHint';
import styles from './LiveCaseCard.module.css';

// The kit's case, slim (board option A, flow 11).

/** The travel estimate (waiting for a decision) or the clock time (decided, or arrived). Never both. */
export type CaseEta =
  | { readonly kind: 'travel'; readonly minutes: number }
  | { readonly kind: 'eta'; readonly time: string }
  | { readonly kind: 'arrived'; readonly time: string };

/** Where a confirmed assignment came from, for the source badge. Fallback is the customer's dispatch after a timeout. */
export type CaseSourceDisplay = 'opendispatch' | 'customer' | 'manual' | 'fallback';

export interface CasePick {
  /** The agent's name; null outside the reader's zones. */
  readonly name: string | null;
  /** A recommendation, not yet a real assignment: which label to show instead of a source badge. */
  readonly label?: 'opendispatch_pick' | 'opendispatch_would_pick' | undefined;
  /** A confirmed assignment's source badge. Omit when `label` is given. */
  readonly source?: CaseSourceDisplay | undefined;
}

/** Why the case sits where it does, one short line with an icon (the kit's reason). */
export type CaseReason =
  | { readonly kind: 'waiting_customer' }
  | { readonly kind: 'would_pick'; readonly name: string; readonly minutes: number }
  | { readonly kind: 'reassigned_from'; readonly name: string };

/** The classification rules' answer for the case: handling, and the rule or the feed that decided it. */
export interface CaseClassification {
  readonly handling: 'field' | 'remote';
  /** The deciding rule's name; null when the default outcome applied. */
  readonly rule: string | null;
  /** `feed`: the feed's own handling was kept. */
  readonly source: 'feed' | 'rules';
}

/** A decided case's live state, shown as a tag in In progress. */
export type CaseProgress = 'assigned' | 'enroute' | 'onscene';

export interface LiveCaseCardProps {
  /** Stable id for the case, for `data-case` and test queries. */
  readonly caseId: string;
  readonly caseNumber: string;
  /** Registration time, already formatted ("10:33"). */
  readonly time: string;
  readonly zone: string;
  /** Minutes waited so far. Given only in the Waiting column. */
  readonly waitMinutes?: number | undefined;
  /** Given in In progress: the state tag. */
  readonly progress?: CaseProgress | undefined;
  readonly pick?: CasePick | undefined;
  readonly eta?: CaseEta | undefined;
  /** Nearest available agent beyond the 10-minute threshold. */
  readonly overReach?: boolean | undefined;
  /** Opens the case drawer (the rest of the case). */
  readonly onOpen?: (() => void) | undefined;
  /** Present: the Accept button shows. */
  readonly onAccept?: (() => void) | undefined;
  /** Present: the Override button shows. */
  readonly onOverride?: (() => void) | undefined;
  /** Why Accept is unavailable to this role right now. Null or omitted: available. */
  readonly acceptDisabledReason?: string | null | undefined;
  readonly overrideDisabledReason?: string | null | undefined;
}

export const SOURCE_TONE = {
  opendispatch: 'accent',
  customer: 'neutral',
  manual: 'info',
  fallback: 'warning',
} as const satisfies Record<CaseSourceDisplay, Tone>;

export const PROGRESS_TONE = {
  assigned: 'neutral',
  enroute: 'info',
  onscene: 'success',
} as const satisfies Record<CaseProgress, Tone>;

/** "ETA 10:46", "Arrived 10:41" or "12 min travel". */
export function useEtaText(): (eta: CaseEta | undefined) => string {
  const t = useTranslations('opendispatch.dispatch');
  const locale = useLocale();
  return (eta) => {
    if (eta === undefined) return '';
    if (eta.kind === 'travel') return t('travelMin', { n: int(eta.minutes, locale) });
    return t(eta.kind === 'eta' ? 'etaAt' : 'arrivedAt', { time: eta.time });
  };
}

/** Avatar and name, or a muted line when unreadable. */
export function PickName({ name, muted = false }: { readonly name: string | null; readonly muted?: boolean }) {
  const t = useTranslations('opendispatch.dispatch');
  if (name === null) return <span className={cx(styles.pickName, styles.muted)} data-pick-unknown="">{t('outsideScope')}</span>;
  return (
    <>
      <Avatar name={name} size="sm" />
      <span className={cx(styles.pickName, muted && styles.muted)} translate="no">
        {name}
      </span>
    </>
  );
}

export function LiveCaseCard({
  caseId,
  caseNumber,
  time,
  zone,
  waitMinutes,
  progress,
  pick,
  eta,
  overReach,
  onOpen,
  onAccept,
  onOverride,
  acceptDisabledReason,
  overrideDisabledReason,
}: LiveCaseCardProps) {
  const t = useTranslations('opendispatch.dispatch');
  const locale = useLocale();
  const etaText = useEtaText();

  // One status line: wait, or state and time
  const status: ReactNode =
    waitMinutes !== undefined ? (
      <>
        <Badge tone="warning" dot size="sm">
          <span dir="ltr" translate="no">
            {t('waitingMin', { n: int(waitMinutes, locale) })}
          </span>
        </Badge>
        {overReach === true ? (
          <Badge tone="danger" dot size="sm">
            {t('overReach')}
          </Badge>
        ) : null}
      </>
    ) : (
      <>
        {progress === undefined ? null : (
          <Badge tone={PROGRESS_TONE[progress]} dot size="sm">
            {t(`state.${progress}`)}
          </Badge>
        )}
        {eta === undefined || eta.kind === 'travel' ? null : <span translate="no">{etaText(eta)}</span>}
        {pick?.source === 'fallback' ? (
          <Badge tone={SOURCE_TONE.fallback} size="sm">
            {t('source.fallback')}
          </Badge>
        ) : null}
      </>
    );

  const would = pick?.label === 'opendispatch_would_pick';
  const name = pick ? (
    <div className={styles.pick}>
      <PickName name={pick.name} muted={would} />
      {pick.label === 'opendispatch_pick' && pick.name !== null ? <span className={styles.pickMeta}>{t('pickOpenDispatch')}</span> : null}
    </div>
  ) : null;

  // A click on the card opens it; buttons act alone
  const onCardClick = (event: MouseEvent<HTMLElement>) => {
    if (onOpen === undefined) return;
    if (event.target instanceof Element && event.target.closest('button, a, [role="button"]')) return;
    onOpen();
  };

  return (
    <article className={cx(styles.card, onOpen && styles.clickable)} data-case={caseId} data-testid="live-case-card" onClick={onCardClick}>
      <div className={styles.head}>
        <button type="button" className={styles.open} onClick={onOpen} aria-label={t('open', { case: caseNumber })}>
          <span className={styles.id} translate="no">
            {caseNumber}
          </span>
        </button>
        <span className={styles.time} dir="ltr" translate="no">
          {time}
        </span>
      </div>
      <div className={styles.meta}>
        <Tag color="gray">
          <span translate="no">{zone}</span>
        </Tag>
        {status}
      </div>
      {name === null ? null : would ? <Tooltip content={t('pickWould')}>{name}</Tooltip> : name}
      {onAccept || onOverride ? (
        <div className={styles.actions}>
          {onAccept ? (
            <ReasonHint reason={acceptDisabledReason} visible={false}>
              <Button variant="primary" size="sm" startIcon={<Check />} onClick={onAccept} className={styles.action}>
                {t('accept')}
              </Button>
            </ReasonHint>
          ) : null}
          {onOverride ? (
            <ReasonHint reason={overrideDisabledReason} visible={false}>
              <Button variant="secondary" size="sm" startIcon={<ArrowLeftRight />} onClick={onOverride} className={styles.action}>
                {t('override')}
              </Button>
            </ReasonHint>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
