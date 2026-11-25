// SPDX-License-Identifier: AGPL-3.0-only
// Forecast against actual: shapes, pure.

import type { DataSource, ForecastAccuracy } from '@/lib/types';

export interface AccuracyZoneName {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface AccuracyCardData {
  readonly error: boolean;
  readonly accuracy: ForecastAccuracy | null;
  readonly days: readonly { readonly value: string; readonly label: string }[];
  readonly zones: readonly AccuracyZoneName[];
  readonly canRun: boolean;
  readonly running: boolean;
  /** The run's and the cases' sources. */
  readonly sources: readonly DataSource[];
  readonly mixed: boolean;
}

export type AccuracyRow = ForecastAccuracy['zones'][number] & { readonly zone: AccuracyZoneName };

/** The zones of the city, in the city's order. */
export function cityRows(accuracy: ForecastAccuracy, zones: readonly AccuracyZoneName[]): AccuracyRow[] {
  const byId = new Map(accuracy.zones.map((z) => [z.zone_id, z] as const));
  return zones.flatMap((zone) => {
    const row = byId.get(zone.id);
    return row === undefined ? [] : [{ ...row, zone }];
  });
}

/** Mean of |forecast - actual| / actual over the rows; null without cases. */
export function rowsMape(rows: readonly Pick<AccuracyRow, 'figures'>[]): number | null {
  const errors = rows.filter((r) => r.figures.actual > 0).map((r) => Math.abs(r.figures.forecast - r.figures.actual) / r.figures.actual);
  return errors.length === 0 ? null : errors.reduce((a, b) => a + b, 0) / errors.length;
}
