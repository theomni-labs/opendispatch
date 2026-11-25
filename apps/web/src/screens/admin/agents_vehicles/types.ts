// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Agents and Vehicles screen: what the server side hands to the client files.
// Everything here is JSON-safe. Nothing here is a context, a customer or the caller's role.

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export type Day = (typeof DAYS)[number];

export const VEHICLE_TYPES = ['sedan', 'suv', 'pickup'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const LEAVE_STATUSES = ['approved', 'requested', 'declined'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** The zone filter value for the remote pool (an agent with no home zone). */
export const REMOTE_POOL = 'remote';

export interface LeaveItem {
  readonly type: string;
  readonly status: LeaveStatus;
  /** `YYYY-MM-DD`. */
  readonly from: string;
  readonly to: string;
}

export interface AgentRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: 'field' | 'remote';
  readonly zoneId: string | null;
  readonly zoneCode: string | null;
  readonly shiftCode: string | null;
  readonly shiftName: string | null;
  readonly vehicleId: string | null;
  readonly vehicleCode: string | null;
  readonly skills: readonly string[];
  readonly daysOff: readonly Day[];
  readonly standbyPointId: string | null;
  readonly active: boolean;
  readonly leave: readonly LeaveItem[];
  /** Shift pattern ids the agent may work; empty: any of the kind. */
  readonly eligibleShiftIds: readonly string[];
  /** Annual leave entitlement in days; null when not recorded. */
  readonly annualLeaveDays: number | null;
  /** Approved annual leave days in the demo year. */
  readonly annualLeaveTaken: number;
}

export interface VehicleRow {
  readonly id: string;
  readonly code: string;
  readonly plate: string;
  readonly type: VehicleType | null;
  readonly zoneId: string;
  readonly zoneCode: string;
  readonly active: boolean;
  /** The agent whose default vehicle it is (the roster's assignment of the day is not read here). */
  readonly assignedTo: string | null;
}

export interface SkillRow {
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly inUse: number;
}

export interface ZoneChoice {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface ShiftChoice {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: 'field' | 'remote';
}

export interface StandbyChoice {
  readonly id: string;
  readonly zoneId: string;
  readonly name: string;
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types:
// no field here is a context, customer, user, role, zone scope or install mode.
// ---------------------------------------------------------------------------------------------

export interface SaveAgentInput {
  /** The agent being changed; absent when one is added. */
  readonly targetId?: string | undefined;
  readonly name_en: string;
  /** The staff code, for an add. Ignored on a change (the code stays). */
  readonly code: string;
  /** The home zone id, or empty for the remote pool. */
  readonly zone_id: string;
  readonly shift_code: string;
  readonly vehicle_id: string;
  readonly standby_point_id: string;
  readonly days_off: readonly string[];
  readonly skill_codes: readonly string[];
  /** Eligible shift pattern ids; empty for any of the kind. */
  readonly eligible_shift_ids?: readonly string[] | undefined;
  /** Whole days as typed; empty when not recorded. */
  readonly annual_leave_days?: string | undefined;
  readonly is_active: boolean;
}

export interface SaveVehicleInput {
  readonly targetId?: string | undefined;
  readonly code: string;
  readonly plate_number: string;
  readonly vehicle_type: string;
  readonly zone_id: string;
  readonly is_active: boolean;
}

export interface AgentTargets {
  readonly targetIds: readonly string[];
}

export interface AddSkillInput {
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
}

export interface RenameSkillInput {
  readonly code: string;
  readonly name_ar: string;
}

export interface SkillTarget {
  readonly code: string;
}

export interface ImportAgentsInput {
  /** The text of the CSV file, read in the browser. */
  readonly file: string;
}

export interface SavedSummary {
  readonly id: string;
  readonly name: string;
  readonly created: boolean;
}

export interface DeactivateResult {
  readonly changed: number;
  readonly failed: number;
  readonly firstProblem?: string | undefined;
}

export interface SkillSummary {
  readonly code: string;
}

export interface ImportSummary {
  readonly agents: number;
  readonly skills: number;
}
