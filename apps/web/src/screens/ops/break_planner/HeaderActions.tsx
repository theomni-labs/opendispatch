'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button } from '@opendispatch/ui';
import { Download, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { generateBreakPlanAction } from './actions';
import { useExportStub } from '@/components/opendispatch/patterns/useExportStub';

// Header (#bp): Generate plan, Export (stub)

export interface HeaderActionsProps {
  readonly zoneId: string;
  readonly date: string;
  readonly generateReason: string | null;
}

export function HeaderActions({ zoneId, date, generateReason }: HeaderActionsProps) {
  const m = useTranslations('ops.break_planner');
  const t = useTranslations();
  const exportStub = useExportStub();
  const generate = useAdminAction(generateBreakPlanAction, {
    successTitle: m('toast.generated'),
    successDescription: (plan) => m('toast.generatedDesc', { n: plan.slots.length, c: plan.slots.filter((s) => s.prayer_conflict !== null).length }),
  });

  return (
    <>
      <ReasonHint reason={generateReason} visible={false}>
        <Button variant="primary" startIcon={<Sparkles />} loading={generate.pending} onClick={() => generate.run({ zoneId, date })}>
          {m('generate')}
        </Button>
      </ReasonHint>
      <Button variant="secondary" startIcon={<Download />} onClick={exportStub}>
        {t('common.export')}
      </Button>
      <ActionError error={generate.error} onDismiss={generate.reset} />
    </>
  );
}
