'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Break Planner writes

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { generateBreakPlan, isoAtMinute, updateBreakSlot } from '@/lib/data/breaks';
import { InvalidInputError } from '@/lib/data/errors';
import type { BreakPlan, BreakSlot } from '@/lib/types';
import type { GenerateBreakPlanInput, UpdateBreakSlotInput } from './types';

const REVALIDATE = '/ops/break-planner';

export async function generateBreakPlanAction(input: GenerateBreakPlanInput): Promise<ActionResult<BreakPlan>> {
  return runAction(
    (ctx) => {
      const zoneId = pickText(input, 'zoneId');
      const date = pickText(input, 'date');
      if (zoneId === undefined || zoneId === '' || date === undefined || date === '') throw new InvalidInputError('Generate plan: choose a zone and a day.');
      return generateBreakPlan(ctx, { zone_id: zoneId, roster_date: date });
    },
    { revalidate: REVALIDATE },
  );
}

export async function updateBreakSlotAction(input: UpdateBreakSlotInput): Promise<ActionResult<BreakSlot>> {
  return runAction(
    (ctx) => {
      const rosterAssignmentId = pickText(input, 'rosterAssignmentId') ?? '';
      const date = pickText(input, 'date');
      const startMin = pickFields(input, ['startMin'])['startMin'];
      if (date === undefined || date === '' || typeof startMin !== 'number' || !Number.isFinite(startMin)) throw new InvalidInputError('Move break: choose a valid time.');
      return updateBreakSlot(ctx, rosterAssignmentId, { start_at: isoAtMinute(date, startMin) });
    },
    { revalidate: REVALIDATE },
  );
}
