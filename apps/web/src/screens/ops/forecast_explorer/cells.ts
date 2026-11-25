// SPDX-License-Identifier: AGPL-3.0-only
// Pure: the cell layer's types and geometry.
/// <reference types="geojson" />

import type { DataSource } from '@/lib/types';

export interface FxCell {
  readonly id: string;
  readonly probability: number;
  readonly pooled: boolean;
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export type CellsView =
  | { readonly status: 'off' }
  | { readonly status: 'empty' | 'error' }
  | { readonly status: 'filled'; readonly cells: readonly FxCell[]; readonly hourExpected: number; readonly source: DataSource; readonly illustrative: boolean };

/** Five heat steps, by share of the top. */
export function cellLevel(p: number, max: number): 1 | 2 | 3 | 4 | 5 {
  if (max <= 0) return 1;
  return Math.min(5, Math.max(1, Math.ceil((p / max) * 5))) as 1 | 2 | 3 | 4 | 5;
}

export interface CellFeatureProps {
  readonly id: string;
  readonly level: number;
  readonly pooled: 0 | 1;
}

export function cellFeatureCollection(cells: readonly FxCell[]): GeoJSON.FeatureCollection<GeoJSON.Polygon, CellFeatureProps> {
  const max = Math.max(0, ...cells.filter((c) => !c.pooled).map((c) => c.probability));
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature' as const,
      properties: { id: c.id, level: c.pooled ? 0 : cellLevel(c.probability, max), pooled: c.pooled ? (1 as const) : (0 as const) },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [c.west, c.south],
            [c.east, c.south],
            [c.east, c.north],
            [c.west, c.north],
            [c.west, c.south],
          ],
        ],
      },
    })),
  };
}

/** Bounds of the listed cells, pool left out. */
export function cellBounds(cells: readonly FxCell[]): [[number, number], [number, number]] | null {
  const own = cells.filter((c) => !c.pooled);
  if (own.length === 0) return null;
  return [
    [Math.min(...own.map((c) => c.west)), Math.min(...own.map((c) => c.south))],
    [Math.max(...own.map((c) => c.east)), Math.max(...own.map((c) => c.north))],
  ];
}

/** Interval expected over the day mean. */
export function timeOfDayFactor(expected: readonly number[], time: number): number {
  const total = expected.reduce((s, v) => s + v, 0);
  return total > 0 ? ((expected[time] ?? 0) * expected.length) / total : 0;
}

/** Expected cases in the hour holding `time`. */
export function hourExpectedOf(expected: readonly number[], time: number): number {
  const start = Math.floor(time / 4) * 4;
  return expected.slice(start, start + 4).reduce((s, v) => s + v, 0);
}
