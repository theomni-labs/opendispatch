'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Export in the customer plan format (a read, not
// audited) and the backtest start. Rule 2: the
// context is built server-side.

import { pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { runForecastBacktest } from '@/lib/data/forecast-backtest';
import type { ExportFile } from '@/lib/export/download';
import { buildPlanExport } from './planExport';

export interface ExportPlanInput {
  readonly zoneId: string;
  readonly locale: string;
}

export async function exportPlanAction(input: ExportPlanInput): Promise<ActionResult<ExportFile>> {
  return runAction((ctx) => buildPlanExport(ctx, pickText(input, 'zoneId') ?? '', pickText(input, 'locale') === 'ar' ? 'ar' : 'en'));
}

// Administrator only; Go audits it
export async function runBacktestAction(): Promise<ActionResult<{ running: boolean }>> {
  return runAction(async (ctx) => ({ running: (await runForecastBacktest(ctx)).run.state === 'running' }), { revalidate: '/ops/forecast-explorer' });
}
