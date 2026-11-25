// SPDX-License-Identifier: AGPL-3.0-only
// Demand met and 10-minute reach (spec 4.3, 4.6)

/** The fields of a gap cell these figures read. */
export interface KpiCell {
  readonly required: number;
  readonly planned: number;
  readonly reach_share?: number | undefined;
}

/** Share of a cell's required agents that are planned, 0 to 1. */
export function cellMetShare(cell: KpiCell): number {
  if (cell.required <= 0) return 1;
  return Math.max(0, Math.min(cell.planned, cell.required)) / cell.required;
}

/** Share of a cell's field demand beyond 10 minutes; null without a reach. */
export function cellOutOfReach(cell: KpiCell): number | null {
  return cell.reach_share === undefined ? null : Math.max(0, Math.min(1, 1 - cell.reach_share));
}

/** Demand met over cells, weighted by required; null when none is required. */
export function demandMetShare(cells: readonly KpiCell[]): number | null {
  let required = 0;
  let met = 0;
  for (const cell of cells) {
    if (cell.required <= 0) continue;
    required += cell.required;
    met += Math.max(0, Math.min(cell.planned, cell.required));
  }
  return required > 0 ? met / required : null;
}

/** Out of reach over cells, weighted by required; null without reach data. */
export function outOfReachShare(cells: readonly KpiCell[]): number | null {
  let weight = 0;
  let out = 0;
  let any = false;
  for (const cell of cells) {
    const share = cellOutOfReach(cell);
    if (share === null) continue;
    any = true;
    const w = Math.max(0, cell.required);
    weight += w;
    out += w * share;
  }
  if (!any) return null;
  return weight > 0 ? out / weight : 0;
}

export const SHOW_VALUES = ['delta', 'met', 'reach'] as const;
export type ShowValue = (typeof SHOW_VALUES)[number];

/** A cell's grid value: delta, % unmet, or % out of reach. */
export function cellValue(cell: KpiCell & { readonly delta: number }, show: ShowValue): number | null {
  if (show === 'delta') return cell.delta;
  if (show === 'met') return Math.round((1 - cellMetShare(cell)) * 100);
  const out = cellOutOfReach(cell);
  return out === null ? null : Math.round(out * 100);
}
