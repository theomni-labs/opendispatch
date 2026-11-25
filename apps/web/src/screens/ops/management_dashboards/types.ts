// SPDX-License-Identifier: AGPL-3.0-only
// Client-safe vocabulary (no lib/data)

export const SCOPE_VALUES = ['kingdom', 'city', 'zone'] as const;
export type ScopeLevel = (typeof SCOPE_VALUES)[number];

export const STAGE_VALUES = ['shadow', 'recommend', 'automatic'] as const;
export type StageValue = (typeof STAGE_VALUES)[number];

export interface OptionItem {
  readonly value: string;
  readonly label: string;
}
