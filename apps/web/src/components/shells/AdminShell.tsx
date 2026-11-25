// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import type { RequestContext } from '@/lib/data/guard';
import { ConsoleShell } from './ConsoleShell';

/** The Admin Console shell: Access, Reference data, Operations and System groups from menuFor(role, installMode). */
export function AdminShell({ ctx, children }: { ctx: RequestContext; children: ReactNode }) {
  return (
    <ConsoleShell console="admin" ctx={ctx}>
      {children}
    </ConsoleShell>
  );
}
