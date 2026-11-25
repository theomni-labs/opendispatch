'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Run a simulation

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { InvalidInputError } from '@/lib/data/errors';
import { getSimulationRun, runSimulation } from '@/lib/data/simulation';
import type { RunSimulationInput, RunSimulationResult } from './types';

const REVALIDATE = '/ops/service-level-simulator';

export async function runSimulationAction(input: RunSimulationInput): Promise<ActionResult<RunSimulationResult>> {
  return runAction(async (ctx) => {
    const rosterId = pickText(input, 'rosterId');
    const runDate = pickText(input, 'runDate');
    if (rosterId === undefined || rosterId === '' || runDate === undefined || runDate === '') {
      throw new InvalidInputError('Run simulation: choose a roster and a day.');
    }
    const { policy } = pickFields(input, ['policy']);
    const run = await runSimulation(ctx, { roster_id: rosterId, run_date: runDate, assignment_policy: policy });
    const output = run.status === 'succeeded' ? (await getSimulationRun(ctx, run.id)).output : null;
    return { ...run, zones_replayed: output?.zones?.length ?? null };
  }, { revalidate: REVALIDATE });
}
