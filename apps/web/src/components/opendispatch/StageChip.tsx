// SPDX-License-Identifier: AGPL-3.0-only
import { Eye, Lightbulb, Zap, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LiveStage } from '@/lib/types';
import { cx } from './cx';
import styles from './StageChip.module.css';

export interface StageChipProps {
  /** The zone code, from the data (English only for now). */
  zone: string;
  stage: LiveStage;
}

const STAGE: Readonly<Record<LiveStage, { className: string | undefined; Icon: LucideIcon }>> = {
  shadow: { className: styles.shadow, Icon: Eye },
  recommend: { className: styles.recommend, Icon: Lightbulb },
  automatic: { className: styles.automatic, Icon: Zap },
};

export function StageChip({ zone, stage }: StageChipProps) {
  const t = useTranslations('opendispatch.stage');
  const { className, Icon } = STAGE[stage];
  return (
    <span className={cx(styles.chip, className)} data-stage={stage}>
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.zone} translate="no">
        {zone}
      </span>
      <span className={styles.stage}>{t(stage)}</span>
    </span>
  );
}
