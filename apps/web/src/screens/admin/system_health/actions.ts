'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the System Health screen: exactly the data functions of lib/data/system.ts.
//
//   confirmBackupDone   confirmBackup           (a RECORD that the customer took a backup: OpenDispatch runs none, and it says so)
//   createDiagnostics   createDiagnosticsBundle then downloadDiagnosticsBundle
//                       (LABELLED STUB: the file is scripted; it holds settings, health and job runs and never case or personal data)
//
// Both take no argument: there is nothing a person types. Rule 2: no action takes a context, customer, user, role, zone scope or
// install mode from the browser. Each builds its own context with requireRequestContext() inside runAction, and the data function
// authorises and audits. The diagnostics file is created inside the install and returned to the browser that asked, base64 encoded
// (it is small: three JSON files and a README); nothing is sent anywhere.

import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { confirmBackup, createDiagnosticsBundle, downloadDiagnosticsBundle } from '@/lib/data/system';
import type { BackupConfirmed, DiagnosticsFile } from './types';

const REVALIDATE = '/admin/system-health';

/** Records that the customer confirmed a backup, now. */
export async function confirmBackupDone(): Promise<ActionResult<BackupConfirmed>> {
  return runAction(
    async (ctx) => {
      const status = await confirmBackup(ctx, {});
      return { confirmedAt: status.last_confirmed_at ?? '' } satisfies BackupConfirmed;
    },
    { revalidate: REVALIDATE },
  );
}

/** Creates the diagnostics file (audited) and returns it for the browser to save. */
export async function createDiagnostics(): Promise<ActionResult<DiagnosticsFile>> {
  return runAction(
    async (ctx) => {
      const bundle = await createDiagnosticsBundle(ctx);
      const file = await downloadDiagnosticsBundle(ctx, bundle.id);
      return { fileName: file.file_name, contentType: file.content_type, contentBase64: file.content_base64, sizeBytes: bundle.size_bytes } satisfies DiagnosticsFile;
    },
    { revalidate: REVALIDATE },
  );
}
