// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslations } from 'next-intl';
import type { AgentLiveStatus } from '@/lib/types';
import { cx } from './cx';
import styles from './StatusDot.module.css';

/** The contract's live statuses, plus `neutral` for a dot with no status of its own. */
export type StatusDotStatus = AgentLiveStatus | 'neutral';

export interface StatusDotProps {
  status: StatusDotStatus;
  /** Replaces the status name that assistive technology reads. Needed for `neutral`. */
  label?: string | undefined;
  /** Hides the dot from assistive technology. Use it when the status is written right next to the dot. */
  decorative?: boolean | undefined;
}

export const STATUS_DOT_CLASS: Readonly<Record<StatusDotStatus, string | undefined>> = {
  available: styles.available,
  assigned: styles.assigned,
  en_route: styles.enRoute,
  on_scene: styles.onScene,
  on_break: styles.onBreak,
  offline: styles.offline,
  neutral: undefined,
};

export function StatusDot({ status, label, decorative = false }: StatusDotProps) {
  const t = useTranslations('opendispatch.status');
  const name = label ?? (status === 'neutral' ? undefined : t(status));
  const className = cx(styles.dot, STATUS_DOT_CLASS[status]);
  if (decorative || name === undefined) return <i className={className} data-status={status} aria-hidden="true" />;
  return <i className={className} data-status={status} role="img" aria-label={name} />;
}
