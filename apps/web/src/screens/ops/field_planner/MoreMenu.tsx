'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, RefreshCw, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { submitRosterAction } from './actions';
import { useExportStub } from '@/components/opendispatch/patterns/useExportStub';

// More: Submit (real); Rebuild, Export (stubs)

export interface MoreMenuProps {
  readonly rosterId: string;
  readonly canSubmit: boolean;
  readonly submitReason: string | null;
}

export function MoreMenu({ rosterId, canSubmit, submitReason }: MoreMenuProps) {
  const m = useTranslations('ops.field_planner');
  const t = useTranslations();
  const toast = useToast();
  const exportStub = useExportStub();
  const submit = useAdminAction(submitRosterAction, { successTitle: m('toast.submitted'), successDescription: m('toast.submittedDesc') });

  const items: MenuEntry[] = [
    ...(canSubmit || submitReason === null ? [] : [{ type: 'heading', label: submitReason } as const]),
    { label: m('menu.submit'), icon: <Send />, disabled: !canSubmit || submit.pending, onSelect: () => submit.run({ rosterId }) },
    { label: m('menu.rebuild'), icon: <RefreshCw />, onSelect: () => toast({ title: m('toast.rebuild'), description: m('toast.rebuildDesc'), tone: 'info' }) },
    { label: t('common.export'), icon: <Download />, onSelect: exportStub },
  ];

  return <Menu trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} align="end" label={t('common.more')} />;
}
