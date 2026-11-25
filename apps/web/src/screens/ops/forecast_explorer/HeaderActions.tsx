'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, ListChecks, SlidersHorizontal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { downloadText } from '@/lib/export/download';
import { exportPlanAction } from './actions';

// Header actions (#fx): Export (The customer plan format
// CSV for the zone); More (links to Model Admin and
// Classification Rules, shown only if the role may
// open them: view.ts's canOpen* flags).

export interface HeaderActionsProps {
  readonly zoneId: string;
  readonly modelAdminHref: string | null;
  readonly classificationRulesHref: string | null;
}

export function HeaderActions({ zoneId, modelAdminHref, classificationRulesHref }: HeaderActionsProps) {
  const m = useTranslations('ops.forecast_explorer');
  const t = useTranslations();
  const locale = useLocale();
  const exportPlan = useAdminAction(exportPlanAction, {
    successTitle: m('toast.export'),
    successDescription: (file) => file.filename,
    onSuccess: (file) => downloadText(file),
    failureToast: true,
  });

  const items: MenuEntry[] = [
    ...(modelAdminHref === null ? [] : [{ label: t('nav.admin.forecast_model.menu'), icon: <SlidersHorizontal />, href: modelAdminHref } as const]),
    ...(classificationRulesHref === null ? [] : [{ label: t('nav.admin.classification_rules.menu'), icon: <ListChecks />, href: classificationRulesHref } as const]),
  ];

  return (
    <>
      <Button variant="secondary" startIcon={<Download />} loading={exportPlan.pending} onClick={() => exportPlan.run({ zoneId, locale })}>
        {t('common.export')}
      </Button>
      {items.length > 0 ? <Menu trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} align="end" label={t('common.more')} /> : null}
    </>
  );
}
