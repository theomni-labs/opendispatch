// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Security and Compliance screen: what the server side hands to the client files.
// Everything here is JSON-safe. Nothing here is a context, a customer or the caller's role.

export const TABS = ['sessions', 'controls', 'support'] as const;
export type Tab = (typeof TABS)[number];

export const FRAMEWORKS = ['NCA', 'PDPL', 'other'] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export const CONTROL_STATUSES = ['not_started', 'in_progress', 'evidenced', 'not_applicable'] as const;
export type ControlStatus = (typeof CONTROL_STATUSES)[number];

export interface ControlRow {
  readonly id: string;
  /** The control's own reference (`NCA-AC-01`): data. */
  readonly ref: string;
  /** The title as the data layer gives it (English). The screen translates the seeded controls by their reference. */
  readonly title: string;
  readonly framework: Framework;
  readonly status: ControlStatus;
  /** The evidence note, English or whatever the Administrator typed. */
  readonly note: string;
  /** ISO 8601, or null when the control was never reviewed. */
  readonly reviewedAt: string | null;
}

export interface SessionView {
  readonly lengthMinutes: number;
  readonly idleMinutes: number;
  readonly perPerson: number;
}

export interface SupportGrant {
  readonly id: string;
  /** ISO 8601 with offset. */
  readonly startedAt: string;
  readonly endsAt: string | null;
  /** Whole hours of the window, at least 1. */
  readonly hours: number;
  readonly grantedBy: string | null;
  readonly active: boolean;
}

export interface SupportView {
  readonly enabled: boolean;
  readonly maxHours: number;
  readonly grants: readonly SupportGrant[];
  /** The id of the grant that is open now, if any. */
  readonly openGrantId: string | null;
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types: no field
// here is a context, customer, user, role, zone scope or install mode.
// ---------------------------------------------------------------------------------------------

export interface SessionInput {
  readonly session_length_minutes: number;
  readonly idle_timeout_minutes: number;
  readonly max_concurrent_sessions: number;
}

export interface MfaInput {
  readonly required: boolean;
}

export interface EvidenceInput {
  readonly controlId: string;
  readonly status: string;
  readonly evidence_note: string;
}

export interface SupportSettingInput {
  readonly enabled: boolean;
  readonly max_duration_hours: number;
}

export interface GrantInput {
  readonly hours: number;
  readonly reason: string;
}

export interface GrantTarget {
  readonly grantId: string;
}

// What the actions give back.
export interface SessionSaved {
  readonly lengthMinutes: number;
  readonly idleMinutes: number;
  readonly perPerson: number;
}

export interface MfaSaved {
  readonly required: boolean;
}

export interface EvidenceSaved {
  readonly ref: string;
  readonly status: ControlStatus;
}

export interface SupportSettingSaved {
  readonly enabled: boolean;
  readonly maxHours: number;
}

export interface GrantSaved {
  readonly hours: number;
}
