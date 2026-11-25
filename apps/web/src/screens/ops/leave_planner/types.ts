// SPDX-License-Identifier: AGPL-3.0-only
// Client-safe constants (no lib/data import)

export const LEAVE_STATUSES = ['requested', 'approved', 'declined'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_TYPES = ['annual', 'sick', 'emergency', 'other'] as const;
export type LeaveTypeValue = (typeof LEAVE_TYPES)[number];

/** Remote-pool filter value; no zone id matches it. */
export const REMOTE_ZONE_VALUE = 'remote';

export interface CreateLeaveRequestInput {
  readonly agentId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly leaveType: LeaveTypeValue;
}

export interface DecideLeaveInput {
  readonly requestId: string;
  readonly decision: 'approved' | 'declined';
}

export interface BulkDecideLeaveInput {
  readonly requestIds: readonly string[];
  readonly decision: 'approved' | 'declined';
}

/** Decision note, else the request's own note. */
export function noteOf(request: { readonly note?: string | null | undefined; readonly decision_note?: string | null | undefined }): string | null {
  for (const text of [request.decision_note, request.note]) if (typeof text === 'string' && text.trim() !== '') return text.trim();
  return null;
}
