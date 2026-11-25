// SPDX-License-Identifier: AGPL-3.0-only
// Demo-only operations (platform.demo, not available in oidc mode).

import type { DemoResetResult } from '@/lib/types';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';

/** Resets Go's demo data; Administrator only. */
// operationId: resetDemoData
export async function resetDemoData(ctx: RequestContext): Promise<DemoResetResult> {
  return (await businessFetch<DemoResetResult>(ctx, '/demo/reset', { method: 'POST', body: {} }))!;
}
