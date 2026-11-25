'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button } from '@opendispatch/ui';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './CaseSuggestion.module.css';

// Opens Suggested by AI; shows the latest in brief

export interface CaseAiLinkProps {
  readonly summary?: { readonly handling: 'field' | 'remote_inferred'; readonly pct: number } | undefined;
  readonly onOpen: () => void;
}

export function CaseAiLink({ summary, onOpen }: CaseAiLinkProps) {
  const t = useTranslations('opendispatch.caseAi');
  const handling = summary === undefined ? '' : summary.handling === 'field' ? t('handlingField') : t('handlingRemote');
  return (
    <Button variant="link" size="sm" startIcon={<Sparkles />} onClick={onOpen} className={styles.cardLink} data-assistant="case-link">
      {summary === undefined ? t('open') : t('summary', { handling, pct: `${summary.pct}%` })}
    </Button>
  );
}
