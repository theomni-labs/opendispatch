// SPDX-License-Identifier: AGPL-3.0-only
// Client-safe action inputs (no lib/data)

import type { OverrideChangeType, OverrideReasonCode } from '@/lib/types';

export const REASON_CODES: readonly OverrideReasonCode[] = ['agent_unavailable', 'vehicle_unavailable', 'closer_agent_known', 'skills_needed', 'dispatcher_judgement', 'other'];
export const CHANGE_TYPES: readonly OverrideChangeType[] = ['replace_agent', 'change_shift', 'change_vehicle', 'remove_assignment', 'add_assignment'];

export interface RosterActionInput {
  readonly rosterId: string;
}

export interface BuildRosterInput {
  readonly zoneId: string;
  readonly date: string;
}

export interface WeekActionInput {
  /** Any day of the week. */
  readonly weekStart: string;
}

export interface DecisionInput {
  readonly note?: string | null;
}

export interface CreateOverrideInput {
  readonly rosterId: string;
  readonly change_type: OverrideChangeType;
  readonly reason_code: OverrideReasonCode;
  readonly note?: string | null;
  readonly roster_assignment_id?: string | null;
  readonly agent_id?: string | null;
  readonly shift_pattern_id?: string | null;
  readonly vehicle_id?: string | null;
}

export interface OverrideActionInput {
  readonly overrideId: string;
}
