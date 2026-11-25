'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useToast } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';

/** Export not built: say so, never "exported". */
export function useExportStub(): () => void {
  const t = useTranslations('patterns.stub');
  const toast = useToast();
  return () => toast({ title: t('export'), description: t('exportHint'), tone: 'info' });
}
