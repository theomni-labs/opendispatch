// SPDX-License-Identifier: AGPL-3.0-only
// Distributions and small numeric helpers. PURE TypeScript, no Node imports.

import type { Rng } from './rng';

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error about 1e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError(`normalQuantile: p must be in (0, 1), got ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const at = (arr: readonly number[], i: number): number => arr[i] as number;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((at(c, 0) * q + at(c, 1)) * q + at(c, 2)) * q + at(c, 3)) * q + at(c, 4)) * q + at(c, 5)) / ((((at(d, 0) * q + at(d, 1)) * q + at(d, 2)) * q + at(d, 3)) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((at(c, 0) * q + at(c, 1)) * q + at(c, 2)) * q + at(c, 3)) * q + at(c, 4)) * q + at(c, 5)) / ((((at(d, 0) * q + at(d, 1)) * q + at(d, 2)) * q + at(d, 3)) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((at(a, 0) * r + at(a, 1)) * r + at(a, 2)) * r + at(a, 3)) * r + at(a, 4)) * r + at(a, 5)) * q) / (((((at(b, 0) * r + at(b, 1)) * r + at(b, 2)) * r + at(b, 3)) * r + at(b, 4)) * r + 1);
}

/** z of the 90th percentile of a standard normal. */
export const Z90 = 1.2815515655446004;

export interface Lognormal {
  readonly mu: number;
  readonly sigma: number;
}

/** The lognormal whose median and 90th percentile are the given values. */
export function lognormalFromMedianP90(median: number, p90: number): Lognormal {
  if (median <= 0 || p90 <= median) throw new RangeError('lognormalFromMedianP90: need 0 < median < p90');
  return { mu: Math.log(median), sigma: Math.log(p90 / median) / Z90 };
}

/** Value of a lognormal at cumulative probability u in (0, 1). */
export function lognormalQuantile(u: number, dist: Lognormal): number {
  return Math.exp(dist.mu + dist.sigma * normalQuantile(u));
}

/**
 * n uniforms in (0, 1), one from each of n equal strata, in random order. Feeding a quantile function with
 * these makes the sample's median and percentiles sit on the distribution's, with almost no sampling noise.
 */
export function stratifiedUniforms(rng: Rng, n: number): number[] {
  const out: number[] = new Array<number>(n);
  for (let i = 0; i < n; i += 1) out[i] = (i + rng.next()) / n;
  return rng.shuffle(out);
}

/** Split `total` into integers in proportion to `weights` (largest remainder). The parts sum to `total`. */
export function apportion(total: number, weights: readonly number[]): number[] {
  let sum = 0;
  for (const w of weights) sum += w;
  if (sum <= 0) throw new RangeError('apportion: weights must have a positive sum');
  const exact = weights.map((w) => (w / sum) * total);
  const parts = exact.map((x) => Math.floor(x));
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((p, q) => q.frac - p.frac || p.i - q.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] = (parts[i] as number) + 1;
    left -= 1;
  }
  return parts;
}

/** Percentile (0 to 100) by linear interpolation between order statistics. */
export function percentile(sorted: readonly number[], pct: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function median(values: readonly number[]): number {
  return percentile([...values].sort((a, b) => a - b), 50);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

const EARTH_RADIUS_KM = 6371.0088;

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** A point `dxKm` east and `dyKm` north of `origin` (flat-earth offset, fine at city scale). */
export function offsetKm(origin: LatLng, dxKm: number, dyKm: number): LatLng {
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
  return { lat: origin.lat + dyKm / kmPerDegLat, lng: origin.lng + dxKm / kmPerDegLng };
}

/** Move from `a` towards `b` by fraction f in [0, 1] (straight line; fine at city scale). */
export function lerpLatLng(a: LatLng, b: LatLng, f: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}
