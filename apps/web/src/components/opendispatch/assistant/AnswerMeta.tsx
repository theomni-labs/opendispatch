'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Tag } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { IllustrativeLabel } from '../IllustrativeLabel';
import styles from './Assistant.module.css';

// Suggestion tag, Illustrative, provider and model

export interface AnswerMetaProps {
  readonly provider: string;
  readonly model: string;
  readonly durationMs: number;
  /** False for a rule draft (no numbers in it). */
  readonly illustrative?: boolean | undefined;
}

export function AnswerMeta({ provider, model, durationMs, illustrative = true }: AnswerMetaProps) {
  const t = useTranslations('opendispatch.assistant');
  const seconds = (Math.round(durationMs / 100) / 10).toFixed(1);
  return (
    <span className={styles.meta} data-assistant="meta">
      <Tag color="geekblue">{t('suggestion')}</Tag>
      {illustrative ? <IllustrativeLabel /> : null}
      <bdi className={styles.metaText} translate="no" dir="ltr">
        {t('meta', { provider, model, seconds })}
      </bdi>
    </span>
  );
}
