// SPDX-License-Identifier: AGPL-3.0-only
// Rolling forecast accuracy.

import type { RollingForecastAccuracy } from '@/lib/types';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';

// operationId: getRollingForecastAccuracy
export async function getRollingForecastAccuracy(ctx: RequestContext): Promise<RollingForecastAccuracy> {
  return (await businessFetch<RollingForecastAccuracy>(ctx, '/models/accuracy'))!;
}
