'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Apply the recommended move

import { pickFields } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { applyStandbyMove } from '@/lib/data/standby';
import type { Coverage } from '@/lib/types';

const REVALIDATE = '/ops/standby-coverage';

export interface ApplyMoveInput {
  readonly zone_id: string;
  readonly roster_date: string;
  readonly from_standby_point_id: string;
  readonly to_standby_point_id: string;
  readonly agents: number;
}

export async function applyMoveAction(input: ApplyMoveInput): Promise<ActionResult<Coverage>> {
  return runAction(
    (ctx) =>
      applyStandbyMove(
        ctx,
        pickFields(input, ['zone_id', 'roster_date', 'from_standby_point_id', 'to_standby_point_id', 'agents']),
      ),
    { revalidate: REVALIDATE },
  );
}
