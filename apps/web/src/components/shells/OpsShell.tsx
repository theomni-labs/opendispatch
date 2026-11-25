// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import type { RequestContext } from '@/lib/data/guard';
import { ConsoleShell } from './ConsoleShell';

/** The Ops Console shell: Live, Plan and Analyze groups from menuFor(role, installMode). */
export function OpsShell({ ctx, children }: { ctx: RequestContext; children: ReactNode }) {
  return (
    <ConsoleShell console="ops" ctx={ctx}>
      {children}
    </ConsoleShell>
  );
}
