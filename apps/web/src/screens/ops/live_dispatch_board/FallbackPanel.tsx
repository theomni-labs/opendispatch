'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Popover, Stat, useFormat } from '@opendispatch/ui';
import { ChevronDown, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StageChip } from '@/components/opendispatch/StageChip';
import styles from './Figures.module.css';
import type { FallbackView, StageRow } from './types';

export interface FallbackPanelProps {
  readonly fallback: FallbackView;
  /** The stage per zone, in the Stages popover. */
  readonly stages?: readonly StageRow[] | undefined;
}

function useMeta(fallback: FallbackView): string | undefined {
  const m = useTranslations('ops.live_dispatch_board');
  if (!fallback.active) return m('fallback.armedMeta', { s: fallback.timeoutSeconds });
  return fallback.sinceTime === null ? undefined : m(`fallback.since.${fallback.reason}`, { time: fallback.sinceTime });
}

/** Rule 19: the fallback figure, armed or active, with the stage per zone. */
export function FallbackPanel({ fallback, stages = [] }: FallbackPanelProps) {
  const m = useTranslations('ops.live_dispatch_board');
  const t = useTranslations();
  const format = useFormat();
  const meta = useMeta(fallback);
  const Icon = fallback.active ? TriangleAlert : ShieldCheck;
  return (
    <section className={fallback.active ? styles.fallbackActive : styles.fallback} role="status" aria-live="polite" aria-label={m('fallback.label')} data-active={String(fallback.active)}>
      <Stat
        label={m('fallback.label')}
        icon={<Icon className={styles.fallbackIcon} />}
        value={m(fallback.active ? 'fallback.activeShort' : 'fallback.armedShort')}
        hint={meta}
        footer={
          <div className={styles.fallbackFoot}>
            <span className={styles.count}>
              <b dir="ltr" translate="no">
                {format.int(fallback.count)}
              </b>{' '}
              {t('opendispatch.fallback.cases')}
            </span>
            {stages.length === 0 ? null : (
              <Popover
                label={m('stage.title')}
                trigger={
                  <Button variant="link" size="sm" endIcon={<ChevronDown />}>
                    {m('stage.button')}
                  </Button>
                }
              >
                <div className={styles.stages}>
                  <span className={styles.stagesTitle}>{m('stage.title')}</span>
                  {stages.map((s) => (
                    <StageChip key={s.zoneId} zone={s.zoneCode} stage={s.stage} />
                  ))}
                </div>
              </Popover>
            )}
          </div>
        }
      />
    </section>
  );
}

/** The warning line under the figures while fallback is active. */
export function FallbackAlert({ fallback }: { readonly fallback: FallbackView }) {
  const m = useTranslations('ops.live_dispatch_board');
  const meta = useMeta(fallback);
  if (!fallback.active) return null;
  return (
    <Alert tone="warning" title={m('fallback.active')}>
      {meta}
    </Alert>
  );
}
