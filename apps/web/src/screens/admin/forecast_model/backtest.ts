// SPDX-License-Identifier: AGPL-3.0-only
// Backtest card helpers: pure, no data access.

import type { ForecastBacktest, ForecastBacktestState } from '@/lib/types';

export type BacktestLatest = ForecastBacktest;
export type BacktestZone = ForecastBacktest['weakest_zones'][number];
export type GateResult = ForecastBacktest['gate']['result'];

/** What the card gets from the server. */
export interface BacktestCardData {
  readonly state: ForecastBacktestState | null;
  readonly error: boolean;
  readonly zoneNames: Readonly<Record<string, string>>;
}

/** Relative improvement of model over base. */
export function improvementOf(model: number | null | undefined, base: number | null | undefined): number | null {
  if (model == null || base == null || base <= 0) return null;
  return (base - model) / base;
}

/** The arm the gate compared with. */
export function gateArm(latest: BacktestLatest): ForecastBacktest['naive'] {
  return latest.gate.baseline === 'segment' && latest.segment != null ? latest.segment : latest.naive;
}

/** Kept for another model than the active one. */
export function isStale(state: ForecastBacktestState): boolean {
  return state.latest != null && state.active_model !== '' && state.latest.model_version !== state.active_model;
}

/** Result line key: better, only, or worse. */
export function resultKey(improvement: number | null, target: number): 'resBetter' | 'resShort' | 'resWorse' | null {
  if (improvement === null) return null;
  if (improvement < 0) return 'resWorse';
  return improvement >= target ? 'resBetter' : 'resShort';
}

/** Backtest MAPE against the MAPE target. */
export function mapeStatus(mape: number | null | undefined, target: number | null): 'ok' | 'above' | null {
  if (mape == null || target === null) return null;
  return mape <= target ? 'ok' : 'above';
}

/** The zone's worst hours by WAPE. */
export function worstHours(zone: BacktestZone, n = 3): BacktestZone['hours'] {
  return [...zone.hours].filter((h) => h.wape != null).sort((a, b) => (b.wape ?? 0) - (a.wape ?? 0) || a.hour - b.hour).slice(0, n);
}

/** Below this many cases a zone is "few cases". */
export const FEW_CASES = 100;

/** The badge's sources for a kept backtest. */
export function sourcesOf(latest: Pick<BacktestLatest, 'data_source' | 'mixed_sources'>): ForecastBacktest['data_source'][] {
  if (!latest.mixed_sources) return [latest.data_source];
  return latest.data_source === 'SYNTHETIC' ? ['SYNTHETIC', 'IMPORTED'] : ['IMPORTED', 'LIVE'];
}
