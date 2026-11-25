'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button } from '@opendispatch/ui';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useExportStub } from '@/components/opendispatch/patterns/useExportStub';

// Header (#pm): Export (stub)

export function HeaderActions() {
  const t = useTranslations();
  const exportStub = useExportStub();

  return (
    <Button variant="secondary" startIcon={<Download />} onClick={exportStub}>
      {t('common.export')}
    </Button>
  );
}
