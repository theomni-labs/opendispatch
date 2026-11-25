// SPDX-License-Identifier: AGPL-3.0-only
import { Alert } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import type { ClientFailure } from '@/lib/actions/types';
import styles from './ActionError.module.css';

export interface ActionErrorProps {
  /** `error` of `useAdminAction`. Null renders nothing. */
  error: ClientFailure | null;
  onDismiss?: (() => void) | undefined;
}

// Codes that mean "fix what you sent" or "it is not possible now" are a warning; the rest (no session, no permission, not
// found, a server or network failure) are danger. Both tones are announced (role="alert").
const WARNING_CODES: ReadonlySet<ClientFailure['code']> = new Set(['invalid', 'conflict']);

// Reason codes with a translated line
export const KNOWN_REASONS: ReadonlySet<string> = new Set(['STORAGE_UNAVAILABLE', 'FEED_OUTAGE_SIMULATION_OFF', 'ASSISTANT_OFF', 'ASSISTANT_UNAVAILABLE', 'ASSISTANT_INVALID_OUTPUT']);

// Reasons with their own title, not the code's
export const TITLED_REASONS: ReadonlySet<string> = new Set(['ASSISTANT_OFF', 'ASSISTANT_UNAVAILABLE', 'ASSISTANT_INVALID_OUTPUT']);

/** The alert's title key: the reason's own, else the code's. */
export function errorTitleKey(error: Pick<ClientFailure, 'code' | 'reason'>): string {
  return error.reason !== undefined && TITLED_REASONS.has(error.reason) ? `reasonTitle.${error.reason}` : `error.${error.code}`;
}

/**
 * The inline failure of an action: a translated line for the code, then the server's English detail in a small line marked
 * lang="en" dir="ltr" (the data layer's messages are English; the Arabic page says so honestly instead of hiding them), or,
 * for an unexpected error, the reference code to give to support. No stack, no input, no secret ever reaches here.
 */
export function ActionError({ error, onDismiss }: ActionErrorProps) {
  const t = useTranslations('patterns.action');
  if (error === null) return null;
  const showDetail = error.message !== '' && error.code !== 'unexpected' && error.code !== 'network';
  const reason = error.reason !== undefined && KNOWN_REASONS.has(error.reason) ? error.reason : null;
  const detail = (
    <span className={styles.detail} lang="en" dir="ltr" translate="no">
      {error.message}
    </span>
  );
  return (
    <Alert tone={WARNING_CODES.has(error.code) ? 'warning' : 'danger'} title={t(errorTitleKey(error))} {...(onDismiss === undefined ? {} : { onDismiss })}>
      {reason !== null ? <span className={styles.reason}>{t(`reason.${reason}`)}</span> : null}
      {showDetail && reason !== null ? (
        <details className={styles.more}>
          <summary>{t('details')}</summary>
          {detail}
        </details>
      ) : null}
      {showDetail && reason === null ? detail : null}
      {error.code === 'unexpected' && error.reference !== undefined ? (
        <span className={styles.detail}>{t('reference', { reference: error.reference })}</span>
      ) : null}
    </Alert>
  );
}
