// SPDX-License-Identifier: AGPL-3.0-only
// The one input of the generator: scripts/synthetic/calibration.json.
// Imported as JSON (no fs), so this module is safe for the app to bundle.

import raw from '../calibration.json';

export const calibration = raw;
export type Calibration = typeof raw;

/** Every `{ value, source }` leaf must carry one of the two allowed source strings. Returns the offenders. */
export function findBadSources(node: unknown, path = '$'): string[] {
  const bad: string[] = [];
  if (Array.isArray(node)) {
    node.forEach((item, i) => bad.push(...findBadSources(item, `${path}[${i}]`)));
  } else if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if ('source' in obj && obj['source'] !== 'assumption' && obj['source'] !== 'Imported sample, 1 Sep 2026') {
      bad.push(`${path}.source = ${JSON.stringify(obj['source'])}`);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k !== 'source') bad.push(...findBadSources(v, `${path}.${k}`));
    }
  }
  return bad;
}

/** Count of `source` fields by value, for the README and the tests. */
export function countSources(node: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n !== null && typeof n === 'object') {
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (k === 'source' && typeof v === 'string') counts[v] = (counts[v] ?? 0) + 1;
        else walk(v);
      }
    }
  };
  walk(node);
  return counts;
}
