'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Drawer } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { reviewCaseAction, suggestCaseAction } from '@/components/opendispatch/assistant/case-actions';
import type { CaseAiCard } from '@/components/opendispatch/assistant/caseCard';
import { CaseSuggestionCard } from '@/components/opendispatch/assistant/CaseSuggestionCard';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';

// Suggested by AI drawer (#ldb-ai)

export interface CaseAiDrawerProps {
  readonly card: CaseAiCard | null;
  /** Case number and zone, for the subtitle. */
  readonly subtitle: string | null;
  readonly canEdit: boolean;
}

export function CaseAiDrawer({ card, subtitle, canEdit }: CaseAiDrawerProps) {
  const t = useTranslations();
  const url = useUrlState();
  const close = () => url.update({ ai: null }, { keepPage: true });
  return (
    <Drawer
      open={card !== null}
      onClose={close}
      title={t('opendispatch.caseAi.title')}
      subtitle={
        subtitle === null ? undefined : (
          <span dir="ltr" translate="no">
            {subtitle}
          </span>
        )
      }
      footer={
        <Button variant="ghost" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      {card === null ? null : <CaseSuggestionCard view={card.view} configured={card.configured} offline={card.offline} canEdit={canEdit} suggestAction={suggestCaseAction} reviewAction={reviewCaseAction} />}
    </Drawer>
  );
}
