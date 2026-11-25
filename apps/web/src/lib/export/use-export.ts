'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslations } from 'next-intl';
import { useAdminAction, type AdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import type { ActionResult } from '@/lib/actions/types';
import { downloadText, type ExportFile } from './download';

// The Export item of a module whose file the server builds (the Audit Log with its filters, a report over more rows than
// the page holds): a server action returns an ActionResult of an ExportFile, and this hook saves it.
//
//   const exportLog = useExport(exportAuditLog);                 // exportAuditLog: () => Promise<ActionResult<ExportFile>>
//   <Button loading={exportLog.pending} onClick={() => exportLog.run()}>{t('common.export')}</Button>
//   <ActionError error={exportLog.error} onDismiss={exportLog.reset} />
//
// A failure is kept as `error` like any action (translated line, English detail); success saves the file and toasts its name.
// The rows already on screen need no action: `saveCsv(filename, table)` from download.ts.

export function useExport<A extends readonly unknown[]>(action: (...args: A) => Promise<ActionResult<ExportFile>>): AdminAction<A> {
  const t = useTranslations('patterns.export');
  return useAdminAction(action, {
    successTitle: t('ready'),
    successDescription: (file) => file.filename,
    onSuccess: (file) => downloadText(file),
  });
}
