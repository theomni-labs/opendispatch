// SPDX-License-Identifier: AGPL-3.0-only
// Client-safe constants (no lib/data import)

export const DENSITY_VALUES = ['q', 'h'] as const;
export type Density = (typeof DENSITY_VALUES)[number];

export const CAUSE_VALUES = ['people', 'vehicles', 'geography'] as const;
export type CauseValue = (typeof CAUSE_VALUES)[number];

export type DetailKey = 'detail.ok' | 'detail.gap.people' | 'detail.gap.vehicles' | 'detail.gap.geography' | 'detail.surplus.people';

/** The drawer's cause line, as a message key. */
export function detailKeyOf(kind: 'gap' | 'surplus' | 'balanced', cause: CauseValue | null | undefined): DetailKey {
  if (kind === 'balanced' || cause === null || cause === undefined) return 'detail.ok';
  if (kind === 'surplus') return 'detail.surplus.people';
  return cause === 'vehicles' ? 'detail.gap.vehicles' : cause === 'geography' ? 'detail.gap.geography' : 'detail.gap.people';
}
