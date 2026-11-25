// SPDX-License-Identifier: AGPL-3.0-only
// What a scenario changes, as parts: pure.

import type { RemoteMode } from './types';

export type ChangePart =
  | { readonly kind: 'field' | 'remote' | 'veh'; readonly n: number }
  | { readonly kind: 'pats'; readonly codes: readonly string[] }
  | { readonly kind: 'share'; readonly p: number };

export interface ChangeInput {
  readonly field: number;
  readonly remote: number;
  readonly veh: number;
  readonly patternCodes: readonly string[];
  readonly sharePercent: number | null;
}

/** The parts in the mockup's order. */
export function changeParts(input: ChangeInput): ChangePart[] {
  const parts: ChangePart[] = [];
  if (input.field !== 0) parts.push({ kind: 'field', n: input.field });
  if (input.remote !== 0) parts.push({ kind: 'remote', n: input.remote });
  if (input.veh !== 0) parts.push({ kind: 'veh', n: input.veh });
  if (input.patternCodes.length > 0) parts.push({ kind: 'pats', codes: input.patternCodes });
  if (input.sharePercent !== null) parts.push({ kind: 'share', p: input.sharePercent });
  return parts;
}

/** Not simulated: the optimizer plans remote only. */
export function unsupportedParts(input: Pick<ChangeInput, 'remote'>): Array<{ readonly kind: 'remote'; readonly n: number }> {
  return input.remote === 0 ? [] : [{ kind: 'remote', n: input.remote }];
}

export interface RemoteReading {
  readonly mode: RemoteMode;
  /** The company-wide change (mode company). */
  readonly company: number;
  readonly byZone: Readonly<Record<string, number>>;
}

interface RemoteEntry {
  readonly zone_id: string;
  readonly remote_agents?: number | undefined;
}

/** Per zone unless only the first zone carries one. */
export function remoteReading(zoneIds: readonly string[], entries: readonly RemoteEntry[]): RemoteReading {
  const byZone: Record<string, number> = {};
  for (const e of entries) {
    const n = e.remote_agents ?? 0;
    if (n !== 0 && zoneIds.includes(e.zone_id)) byZone[e.zone_id] = n;
  }
  const carried = Object.keys(byZone);
  const [only] = carried;
  if (only === undefined) return { mode: 'company', company: 0, byZone: {} };
  if (carried.length === 1 && only === zoneIds[0]) return { mode: 'company', company: byZone[only] ?? 0, byZone: {} };
  return { mode: 'zone', company: 0, byZone };
}

/** What each zone's entry carries. */
export function remoteDeltas(reading: RemoteReading, zoneIds: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (reading.mode === 'company') {
    const first = zoneIds[0];
    if (first !== undefined && reading.company !== 0) out[first] = reading.company;
    return out;
  }
  for (const z of zoneIds) {
    const n = reading.byZone[z] ?? 0;
    if (n !== 0) out[z] = n;
  }
  return out;
}

/** The one pool change both readings make. */
export function remoteTotal(reading: RemoteReading, zoneIds: readonly string[]): number {
  return Object.values(remoteDeltas(reading, zoneIds)).reduce((sum, n) => sum + n, 0);
}

/** "+4" or "-2": the sign always shown. */
export function signed(n: number): string {
  return n > 0 ? `+${String(n)}` : String(n);
}

/** A translator with has(), as next-intl's. */
export interface Translator {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

/** A pattern's name, or its code if unnamed. */
export function patternLabel(m: Translator, code: string): string {
  return m.has(`shift.${code}`) ? m(`shift.${code}`) : code;
}

/** One part as text, in the page language. */
export function changeText(m: Translator, part: ChangePart): string {
  if (part.kind === 'pats') return part.codes.map((code) => patternLabel(m, code)).join(' / ');
  if (part.kind === 'share') return m('chg.share', { p: part.p });
  return m(`chg.${part.kind}`, { n: signed(part.n) });
}
