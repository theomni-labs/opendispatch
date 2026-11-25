// SPDX-License-Identifier: AGPL-3.0-only
// Accuracy card rows (#fm-acc), pure.

import type { RollingAccuracyFigures, RollingForecastAccuracy } from '@/lib/types';

export type AccuracyBy = 'zone' | 'hour' | 'weekday';

export interface RollingAccuracyCardData {
  readonly state: RollingForecastAccuracy | null;
  readonly error: boolean;
  readonly zoneNames: Readonly<Record<string, string>>;
  /** Sunday first, in the reader's language. */
  readonly weekdays: readonly string[];
}

export interface AccuracyRow {
  readonly key: string;
  /** A zone or weekday name; null for an hour. */
  readonly label: string | null;
  /** Minutes after midnight, for an hour row. */
  readonly minutes: number | null;
  readonly figures: RollingAccuracyFigures;
}

/** The table's rows for one breakdown. */
export function accuracyRows(data: RollingAccuracyCardData, by: AccuracyBy): AccuracyRow[] {
  const state = data.state;
  if (state === null) return [];
  if (by === 'hour') return state.hours.map((h) => ({ key: `h${String(h.hour)}`, label: null, minutes: h.hour * 60, figures: h.figures }));
  if (by === 'weekday') return state.weekdays.map((d) => ({ key: `d${String(d.weekday)}`, label: data.weekdays[d.weekday] ?? String(d.weekday), minutes: null, figures: d.figures }));
  return state.zones.map((z) => ({ key: z.zone_id, label: data.zoneNames[z.zone_id] ?? z.zone_id, minutes: null, figures: z.figures }));
}

/** Whether the card has a stored window to show. */
export function hasWindow(state: RollingForecastAccuracy | null): state is RollingForecastAccuracy & { window_start: string; window_end: string } {
  return state !== null && state.window_start !== null && state.window_end !== null && state.overall !== null;
}

/** The top figure and alert, from the stored window. */
export interface AccuracyFigure {
  readonly mape: number | null;
  readonly target: number;
  readonly days: number;
  readonly illustrative: boolean;
  readonly status: 'at_or_below' | 'above' | null;
  readonly zones: number;
  readonly zonesAbove: number;
}

/** Null when the read failed or was refused. */
export function accuracyFigure(state: RollingForecastAccuracy | null): AccuracyFigure | null {
  if (state === null) return null;
  const rated = state.zones.filter((z) => z.figures.target_status !== null);
  return {
    mape: state.overall?.mape ?? null,
    target: state.mape_target,
    days: state.window_days,
    illustrative: state.illustrative,
    status: state.overall?.target_status ?? null,
    zones: rated.length,
    zonesAbove: rated.filter((z) => z.figures.target_status === 'above').length,
  };
}
