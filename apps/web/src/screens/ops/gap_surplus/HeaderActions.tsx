'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, type MenuEntry } from '@opendispatch/ui';
import { CalendarDays, ChevronDown, Download, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useExportStub } from '@/components/opendispatch/patterns/useExportStub';

// Header (#gs): Export (stub) and More

export interface HeaderActionsProps {
  readonly fieldPlannerHref: string | null;
  readonly standbyHref: string | null;
}

export function HeaderActions({ fieldPlannerHref, standbyHref }: HeaderActionsProps) {
  const t = useTranslations();
  const exportStub = useExportStub();

  const items: MenuEntry[] = [
    ...(fieldPlannerHref === null ? [] : [{ label: t('nav.ops.field_planner.menu'), icon: <CalendarDays />, href: fieldPlannerHref }]),
    ...(standbyHref === null ? [] : [{ label: t('nav.ops.standby_coverage.menu'), icon: <MapPin />, href: standbyHref }]),
  ];

  return (
    <>
      <Button variant="secondary" startIcon={<Download />} onClick={exportStub}>
        {t('common.export')}
      </Button>
      {items.length > 0 ? (
        <Menu trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} align="end" label={t('common.more')} />
      ) : null}
    </>
  );
}
