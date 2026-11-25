'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, useToast } from '@opendispatch/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { buildRosterAction } from './actions';
import { rosterSourceOf } from './source';

// Empty state: build with the placeholder optimizer

export interface BuildRosterButtonProps {
  readonly zoneId: string;
  readonly date: string;
  readonly disabledReason: string | null;
}

export function BuildRosterButton({ zoneId, date, disabledReason }: BuildRosterButtonProps) {
  const m = useTranslations('ops.field_planner');
  const toast = useToast();
  const build = useAdminAction(buildRosterAction, {
    quiet: true,
    onSuccess: (roster) => {
      const source = rosterSourceOf(roster);
      if (source?.kind === 'fallback') toast({ title: m('toast.fallback'), description: m(`source.reason.${source.reason}`), tone: 'warning' });
    },
  });

  return (
    <>
      <ReasonHint reason={disabledReason} visible={false}>
        <Button variant="secondary" startIcon={<Plus />} loading={build.pending} onClick={() => build.run({ zoneId, date })}>
          {m('empty.action')}
        </Button>
      </ReasonHint>
      <ActionError error={build.error} onDismiss={build.reset} />
    </>
  );
}
