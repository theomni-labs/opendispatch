'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Roster writes; Publish is a stub

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { InvalidInputError } from '@/lib/data/errors';
import {
  approveOverride,
  approveRoster,
  buildRoster,
  buildRosterWeek,
  createOverride,
  publishRoster,
  publishRosterWeek,
  rejectOverride,
  rejectRoster,
  submitRoster,
  submitRosterWeek,
} from '@/lib/data/rosters';
import type { Override, PublishResult, Roster, RosterWeekResult } from '@/lib/types';
import type { BuildRosterInput, CreateOverrideInput, DecisionInput, OverrideActionInput, RosterActionInput, WeekActionInput } from './types';

const REVALIDATE = '/ops/field-planner';

/** The Empty state's "Build roster" (mockup): the placeholder optimizer, from the latest succeeded forecast run. */
export async function buildRosterAction(input: BuildRosterInput): Promise<ActionResult<Roster>> {
  return runAction((ctx) => {
    const zoneId = pickText(input, 'zoneId');
    const date = pickText(input, 'date');
    if (zoneId === undefined || zoneId === '' || date === undefined || date === '') throw new InvalidInputError('Build roster: choose a zone and a day.');
    return buildRoster(ctx, { zone_id: zoneId, roster_date: date, forecast_run_id: null });
  }, { revalidate: REVALIDATE });
}

function weekBody(input: WeekActionInput): { week_start: string } {
  const weekStart = pickText(input, 'weekStart');
  if (weekStart === undefined || weekStart === '') throw new InvalidInputError('Week: choose a week.');
  return { week_start: weekStart };
}

/** Build week: every zone's open days of the week. */
export async function buildWeekAction(input: WeekActionInput): Promise<ActionResult<RosterWeekResult>> {
  return runAction((ctx) => buildRosterWeek(ctx, weekBody(input)), { revalidate: REVALIDATE });
}

export async function submitWeekAction(input: WeekActionInput): Promise<ActionResult<RosterWeekResult>> {
  return runAction((ctx) => submitRosterWeek(ctx, weekBody(input)), { revalidate: REVALIDATE });
}

/** LABELLED STUB, as publishRosterAction: nothing is sent to the customer. */
export async function publishWeekAction(input: WeekActionInput): Promise<ActionResult<RosterWeekResult>> {
  return runAction((ctx) => publishRosterWeek(ctx, weekBody(input)), { revalidate: REVALIDATE });
}

export async function submitRosterAction(input: RosterActionInput): Promise<ActionResult<Roster>> {
  return runAction((ctx) => submitRoster(ctx, pickText(input, 'rosterId') ?? ''), { revalidate: REVALIDATE });
}

export async function approveRosterAction(input: RosterActionInput & DecisionInput): Promise<ActionResult<Roster>> {
  return runAction((ctx) => approveRoster(ctx, pickText(input, 'rosterId') ?? '', { note: pickFields(input, ['note'])['note'] ?? null }), { revalidate: REVALIDATE });
}

export async function rejectRosterAction(input: RosterActionInput & DecisionInput): Promise<ActionResult<Roster>> {
  return runAction((ctx) => rejectRoster(ctx, pickText(input, 'rosterId') ?? '', { note: pickFields(input, ['note'])['note'] ?? null }), { revalidate: REVALIDATE });
}

/** LABELLED STUB: publishRoster itself returns { stub: true, published: false }. Nothing is sent to the customer. */
export async function publishRosterAction(input: RosterActionInput): Promise<ActionResult<PublishResult>> {
  return runAction((ctx) => publishRoster(ctx, pickText(input, 'rosterId') ?? ''), { revalidate: REVALIDATE });
}

export async function createOverrideAction(input: CreateOverrideInput): Promise<ActionResult<Override>> {
  return runAction((ctx) => {
    const rosterId = pickText(input, 'rosterId');
    if (rosterId === undefined || rosterId === '') throw new InvalidInputError('Override: choose a roster.');
    const fields = pickFields(input, ['change_type', 'reason_code', 'note', 'roster_assignment_id', 'agent_id', 'shift_pattern_id', 'vehicle_id']);
    return createOverride(ctx, rosterId, fields);
  }, { revalidate: REVALIDATE });
}

export async function approveOverrideAction(input: OverrideActionInput & DecisionInput): Promise<ActionResult<Override>> {
  return runAction((ctx) => approveOverride(ctx, pickText(input, 'overrideId') ?? '', { note: pickFields(input, ['note'])['note'] ?? null }), { revalidate: REVALIDATE });
}

export async function rejectOverrideAction(input: OverrideActionInput & DecisionInput): Promise<ActionResult<Override>> {
  return runAction((ctx) => rejectOverride(ctx, pickText(input, 'overrideId') ?? '', { note: pickFields(input, ['note'])['note'] ?? null }), { revalidate: REVALIDATE });
}
