// SPDX-License-Identifier: AGPL-3.0-only
// SERVER ONLY: why-card and cell-layer reads.

import { getForecastExplanation, getForecastLocations } from '@/lib/data/forecast-insight';
import { listSubZones } from '@/lib/data/locations';
import type { RequestContext } from '@/lib/data/guard';
import type { ForecastExplanation } from '@/lib/types';
import type { CellsView } from './cells';


/** A sub-zone's cells for the hour. */
export async function loadCells(ctx: RequestContext, zoneId: string, subCode: string, day: string, time: number, hourExpected: number): Promise<CellsView> {
  try {
    const subs = (await listSubZones(ctx, { zone_id: zoneId, limit: 200 })).items;
    const sub = subs.find((s) => (typeof s.extra?.['code'] === 'string' ? s.extra['code'] : s.id) === subCode);
    if (sub === undefined) return { status: 'empty' };
    const dist = await getForecastLocations(ctx, { sub_zone_id: sub.id, hour: Math.floor(time / 4), date: day });
    if (dist === null || dist.cells.length === 0) return { status: 'empty' };
    const cells = dist.cells.map((c) => ({ id: c.cell_id, probability: c.probability, pooled: c.pooled, south: c.south, west: c.west, north: c.north, east: c.east }));
    return { status: 'filled', cells, hourExpected, source: dist.data_source, illustrative: dist.illustrative };
  } catch {
    return { status: 'error' };
  }
}

export interface WhyDriver {
  readonly driver: string;
  readonly multiplier: number;
  readonly unknown: boolean;
}

export type WhyView =
  | { readonly status: 'empty' | 'error' }
  | {
      readonly status: 'filled';
      readonly model: string;
      readonly trainingStart: string | undefined;
      readonly trainingEnd: string | undefined;
      readonly base: number;
      readonly expected: number;
      readonly drivers: readonly WhyDriver[];
    };

export function whyOf(e: ForecastExplanation | null): WhyView {
  if (e === null) return { status: 'empty' };
  return {
    status: 'filled',
    model: e.model_version,
    trainingStart: e.training_start,
    trainingEnd: e.training_end,
    base: e.base,
    expected: e.expected,
    drivers: e.drivers.map((d) => ({ driver: d.driver, multiplier: d.multiplier, unknown: d.unknown === true })),
  };
}

export async function loadWhy(ctx: RequestContext, zoneId: string, day: string): Promise<WhyView> {
  try {
    return whyOf(await getForecastExplanation(ctx, { zone_id: zoneId, date: day }));
  } catch {
    return { status: 'error' };
  }
}
