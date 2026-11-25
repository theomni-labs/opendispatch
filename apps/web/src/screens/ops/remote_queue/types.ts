// SPDX-License-Identifier: AGPL-3.0-only
// Client-safe action inputs (no lib/data)

export const QUEUE_TABS = ['waiting', 'in_review', 'done'] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

export const REMOTE_VIEWS = ['queue', 'roster', 'performance'] as const;

export const WAIT_THRESHOLDS = ['60', '240'] as const;

export interface AssignReviewerInput {
  readonly caseId: string;
  readonly agentId: string;
}
