// SPDX-License-Identifier: AGPL-3.0-only
// Top stats, pure (Explain mirrors them)

import { time } from '@opendispatch/ui/format';
import { demandMetShare, outOfReachShare, type KpiCell } from './kpi';
import type { CauseValue } from './types';

export interface CauseCounts {
  readonly people: number;
  readonly vehicles: number;
  readonly geography: number;
}

export interface WorstGap {
  readonly value: number;
  readonly zoneCode: string;
  readonly timeLabel: string;
}

export interface StatsView {
  readonly gaps: number;
  readonly surplus: number;
  readonly worst: WorstGap | null;
  readonly mainCause: CauseValue | null;
  /** 0 to 1; null when unknown. */
  readonly met: number | null;
  readonly outOfReach: number | null;
}

/** The gap cell fields the stats read. */
export interface StatsCell extends KpiCell {
  readonly kind: 'gap' | 'surplus' | 'balanced';
  readonly cause: CauseValue | null;
  readonly delta: number;
  readonly interval_index: number;
}

export interface StatsRow {
  readonly code: string;
  readonly cells: readonly StatsCell[];
}

/** Ties: people, geography (the mockup). */
function causeTieBreak(counts: CauseCounts): CauseValue {
  if (counts.people >= counts.vehicles && counts.people >= counts.geography) return 'people';
  return counts.geography >= counts.vehicles ? 'geography' : 'vehicles';
}

/** Chips (zone filters); stats (cause too). */
export function gapStats(rows: readonly StatsRow[], cause: CauseValue | undefined): { readonly stats: StatsView; readonly causeCounts: CauseCounts } {
  const causeCounts = { people: 0, vehicles: 0, geography: 0 };
  for (const row of rows) for (const cell of row.cells) if (cell.kind === 'gap' && cell.cause !== null) causeCounts[cell.cause] += 1;

  let gaps = 0;
  let surplus = 0;
  let worst: WorstGap | null = null;
  const mainCauseCounts = { people: 0, vehicles: 0, geography: 0 };
  const counted: StatsCell[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cause !== undefined && cell.cause !== cause) continue;
      counted.push(cell);
      if (cell.kind === 'gap') {
        gaps += 1;
        if (cell.cause !== null) mainCauseCounts[cell.cause] += 1;
        if (worst === null || cell.delta < worst.value) worst = { value: cell.delta, zoneCode: row.code, timeLabel: time(cell.interval_index * 15) };
      } else if (cell.kind === 'surplus') {
        surplus += 1;
      }
    }
  }
  const mainCause = gaps === 0 ? null : causeTieBreak(mainCauseCounts);
  return { stats: { gaps, surplus, worst, mainCause, met: demandMetShare(counted), outOfReach: outOfReachShare(counted) }, causeCounts };
}
