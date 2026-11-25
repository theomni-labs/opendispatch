'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { runSimulationAction } from './actions';
import type { AssignmentPolicyOption } from './types';
import { useExportStub } from '@/components/opendispatch/patterns/useExportStub';

// Header (#sl): Run simulation and More

export interface HeaderActionsProps {
  readonly canEdit: boolean;
  readonly hasInputs: boolean;
  readonly rosterId: string;
  readonly runDate: string;
  readonly policy: AssignmentPolicyOption;
}

export function RunButton({ canEdit, hasInputs, rosterId, runDate, policy, variant = 'primary' }: HeaderActionsProps & { readonly variant?: 'primary' | 'secondary' }) {
  const m = useTranslations('ops.service_level_simulator');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();

  const run = useAdminAction(runSimulationAction, {
    quiet: true,
    onSuccess: (result) => {
      url.update({ run: result.id }, { history: 'push' });
      const description = result.zones_replayed === null ? undefined : m('toast.doneDesc', { n: result.zones_replayed });
      toast({ title: m('toast.done'), description, tone: 'success' });
    },
  });

  const reason = !canEdit ? t('opendispatch.gate.viewOnly') : !hasInputs ? m('need.inputs') : null;

  return (
    <>
      <ReasonHint reason={reason} visible={false}>
        <Button variant={variant} startIcon={<Play />} loading={run.pending} onClick={() => reason === null && run.run({ rosterId, runDate, policy })}>
          {m('run')}
        </Button>
      </ReasonHint>
      <ActionError error={run.error} onDismiss={run.reset} />
    </>
  );
}

export function HeaderActions(props: HeaderActionsProps) {
  const m = useTranslations('ops.service_level_simulator');
  const t = useTranslations();
  const exportStub = useExportStub();
  const items: MenuEntry[] = [{ label: m('menu.export'), icon: <Download />, onSelect: exportStub }];
  return (
    <>
      <RunButton {...props} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}
