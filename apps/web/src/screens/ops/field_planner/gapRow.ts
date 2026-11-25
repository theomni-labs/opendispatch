// SPDX-License-Identifier: AGPL-3.0-only
import type { RosterBlock } from '@/components/opendispatch/RosterGrid';

// The roster grid's gap row: pure.

/** One block per run of short intervals; the label is the worst shortfall, positive. Surplus is not drawn. */
export function gapRowBlocksOf(shortfalls: ReadonlyMap<number, number>): RosterBlock[] {
  const indices = [...shortfalls.keys()].filter((i) => (shortfalls.get(i) ?? 0) > 0).sort((a, b) => a - b);
  const blocks: RosterBlock[] = [];
  let run: { from: number; to: number; worst: number } | null = null;
  const close = (r: { from: number; to: number; worst: number }) => blocks.push({ kind: 'gap', from: r.from, to: r.to, label: String(r.worst), tip: String(r.worst) });
  for (const index of indices) {
    const short = shortfalls.get(index) as number;
    const from = index / 4;
    if (run !== null && run.to === from) {
      run = { from: run.from, to: from + 0.25, worst: Math.max(run.worst, short) };
    } else {
      if (run !== null) close(run);
      run = { from, to: from + 0.25, worst: short };
    }
  }
  if (run !== null) close(run);
  return blocks;
}
