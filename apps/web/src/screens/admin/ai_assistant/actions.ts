'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The one write: Test connection (audited by Go).

import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { testAssistantConnection } from '@/lib/data/assistant';
import type { AssistantTestCode, TestOutcome } from './types';

const REVALIDATE = '/admin/ai-assistant';

/** One tiny call to the provider; no argument. */
export async function testConnection(): Promise<ActionResult<TestOutcome>> {
  return runAction(
    async (ctx) => {
      const r = await testAssistantConnection(ctx);
      return { ok: r.ok, durationMs: r.duration_ms, errorCode: (r.error_code ?? null) as AssistantTestCode | null } satisfies TestOutcome;
    },
    { revalidate: REVALIDATE },
  );
}
