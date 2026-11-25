// SPDX-License-Identifier: AGPL-3.0-only
// Seeded randomness for the synthetic generator. Deterministic by construction:
// no Math.random, no clock. Every stream comes from a string seed through `hashSeed`.
//
// PURE TypeScript with no Node imports, because scripts/synthetic/positions.ts is imported by the app.

/**
 * mulberry32, the well-known 32-bit generator by Tommy Ettinger. Returns floats in [0, 1).
 * Kept in the repository (not a dependency) so the sequence can never change under us.
 */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A 32-bit hash of a string (the "xmur3" mixer). Same string, same number, on every machine.
 * Use it to turn "seed/label" into a mulberry32 seed.
 */
export function hashSeed(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Four 32-bit words from one string: enough for a 128-bit id. */
export function hashWords(text: string): [number, number, number, number] {
  return [hashSeed(`${text}#0`), hashSeed(`${text}#1`), hashSeed(`${text}#2`), hashSeed(`${text}#3`)];
}

/** Stable UUID (version 4 layout) for a record: same seed, kind and key give the same id, always. */
export function uuidFor(seed: string, kind: string, key: string): string {
  const [a, b, c, d] = hashWords(`${seed}|${kind}|${key}`);
  const hex = (n: number): string => n.toString(16).padStart(8, '0');
  const h = hex(a) + hex(b) + hex(c) + hex(d); // 32 hex characters
  const variant = ((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A random stream with the helpers the generator needs. */
export class Rng {
  private readonly next01: () => number;

  constructor(
    readonly label: string,
    seedText: string,
  ) {
    this.next01 = mulberry32(hashSeed(seedText));
  }

  /** A new independent stream, named after its purpose, derived from this one's label. */
  fork(name: string): Rng {
    return new Rng(`${this.label}/${name}`, `${this.label}/${name}`);
  }

  /** Float in [0, 1). */
  next(): number {
    return this.next01();
  }

  /** Float in [lo, hi). */
  float(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next01();
  }

  /** Integer in [lo, hi], both inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next01() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next01() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[Math.floor(this.next01() * items.length)] as T;
  }

  /** Index chosen with the given non-negative weights. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next01() * total;
    for (let i = 0; i < weights.length; i += 1) {
      r -= weights[i] as number;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Standard normal by Box-Muller. */
  normal(): number {
    const u = 1 - this.next01(); // (0, 1]
    const v = this.next01();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** In-place Fisher-Yates shuffle. Returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next01() * (i + 1));
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }
}

/** The root stream for a seed string. Fork it by purpose, never share one stream across concerns. */
export function makeRng(seed: string, name = 'root'): Rng {
  return new Rng(`${seed}/${name}`, `${seed}/${name}`);
}
