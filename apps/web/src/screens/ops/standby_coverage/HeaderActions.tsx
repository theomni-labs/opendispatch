'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Map } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useExportStub } from '@/components/opendispatch/patterns/useExportStub';

// Header (#sc): Export (stub), Locations

export interface HeaderActionsProps {
  readonly locationsHref: string | null;
}

export function HeaderActions({ locationsHref }: HeaderActionsProps) {
  const t = useTranslations();
  const exportStub = useExportStub();

  const items: MenuEntry[] = locationsHref === null ? [] : [{ label: t('nav.admin.locations.menu'), icon: <Map />, href: locationsHref }];

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
