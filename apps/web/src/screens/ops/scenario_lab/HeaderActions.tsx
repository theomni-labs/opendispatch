'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { useExportStub } from '@/components/opendispatch/patterns/useExportStub';

// Header (#sc2): New scenario and More

export interface HeaderActionsProps {
  readonly canEdit: boolean;
}

/** Opens the editor on a new scenario. */
export function NewScenarioButton({ canEdit }: HeaderActionsProps) {
  const m = useTranslations('ops.scenario_lab');
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  return (
    <ReasonHint reason={gate.edit.reason} visible={false}>
      <Button variant="secondary" startIcon={<Plus />} onClick={() => gate.edit.allowed && url.update({ scenario: 'new', tpl: null }, { history: 'push', keepPage: true })}>
        {m('new')}
      </Button>
    </ReasonHint>
  );
}

export function HeaderActions({ canEdit }: HeaderActionsProps) {
  const m = useTranslations('ops.scenario_lab');
  const t = useTranslations();
  const exportStub = useExportStub();

  const items: MenuEntry[] = [{ label: m('menu.export'), icon: <Download />, onSelect: exportStub }];

  return (
    <>
      <NewScenarioButton canEdit={canEdit} />
      <Menu trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} align="end" label={t('common.more')} />
    </>
  );
}
