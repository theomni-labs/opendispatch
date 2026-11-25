'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { useExportStub } from '@/components/opendispatch/patterns/useExportStub';

// Header (#lp): New request and More

export interface HeaderActionsProps {
  readonly canEdit: boolean;
}

/** Opens the modal via ?new=1; header and empty state. */
export function NewRequestButton({ canEdit, variant = 'primary' }: HeaderActionsProps & { readonly variant?: 'primary' | 'secondary' }) {
  const m = useTranslations('ops.leave_planner');
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  return (
    <ReasonHint reason={gate.edit.reason} visible={false}>
      <Button variant={variant} startIcon={<Plus />} onClick={() => gate.edit.allowed && url.update({ new: '1' }, { history: 'push', keepPage: true })}>
        {m('new')}
      </Button>
    </ReasonHint>
  );
}

export function HeaderActions({ canEdit }: HeaderActionsProps) {
  const m = useTranslations('ops.leave_planner');
  const t = useTranslations();
  const exportStub = useExportStub();

  const items: MenuEntry[] = [
    { label: m('menu.export'), icon: <Download />, onSelect: exportStub },
  ];

  return (
    <>
      <NewRequestButton canEdit={canEdit} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}
