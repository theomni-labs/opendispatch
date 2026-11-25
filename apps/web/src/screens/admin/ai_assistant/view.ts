// SPDX-License-Identifier: AGPL-3.0-only
// AI Assistant reads: lib/data only.

import type { RequestContext } from '@/lib/data/guard';
import { getAssistantOverview } from '@/lib/data/assistant';
import type { AssistantOverview } from '@/lib/types';
import type { AssistantTestCode, AssistantView } from './types';

/** The overview as the screen draws it. */
export function toView(o: AssistantOverview): AssistantView {
  const calls = o.totals.calls;
  return {
    status: o.status,
    provider: o.provider,
    model: o.model,
    offline: o.offline,
    key: o.key,
    calls,
    successPct: calls === 0 ? null : (o.totals.successes / calls) * 100,
    usage: o.usage.map((u) => ({
      feature: u.feature,
      calls: u.calls,
      successes: u.successes,
      rejected: u.rejected ?? null,
      retried: u.retried ?? null,
      fallbacks: u.fallbacks ?? null,
      medianMs: u.median_ms ?? null,
      p90Ms: u.p90_ms ?? null,
    })),
    lastTest:
      o.last_test === null || o.last_test === undefined
        ? null
        : { ok: o.last_test.ok, durationMs: o.last_test.duration_ms, errorCode: (o.last_test.error_code ?? null) as AssistantTestCode | null, testedAt: o.last_test.tested_at },
  };
}

export async function loadAssistantView(ctx: RequestContext): Promise<AssistantView> {
  return toView(await getAssistantOverview(ctx));
}
