// SPDX-License-Identifier: AGPL-3.0-only
// Client-safe simulator inputs (no lib/data)

import type { SimulationRun } from '@/lib/types';

/** The run, and how many zones it replayed. */
export type RunSimulationResult = SimulationRun & { readonly zones_replayed: number | null };

export const ASSIGNMENT_POLICIES = ['nearest', 'scorer', 'replay_actual'] as const;
export type AssignmentPolicyOption = (typeof ASSIGNMENT_POLICIES)[number];

export const SIMULATOR_TABS = ['zones', 'intervals', 'history'] as const;
export type SimulatorTab = (typeof SIMULATOR_TABS)[number];

export interface RunSimulationInput {
  readonly rosterId: string;
  readonly runDate: string;
  readonly policy: AssignmentPolicyOption;
}
