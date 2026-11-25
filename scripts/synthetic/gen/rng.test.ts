// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashSeed, makeRng, mulberry32, uuidFor } from './rng';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('mulberry32', () => {
  it('matches the reference implementation (known output vector)', () => {
    // Values from an independent implementation of Tommy Ettinger's mulberry32.
    const r = mulberry32(1);
    const got = [r(), r(), r(), r(), r()].map((x) => Number(x.toFixed(10)));
    expect(got).toEqual([0.6270739406, 0.0027357212, 0.52744704, 0.9810509675, 0.9683778982]);
    expect(Number(mulberry32(0)().toFixed(10))).toBe(0.2664292087);
  });

  it('gives floats in [0, 1)', () => {
    const r = mulberry32(42);
    for (let i = 0; i < 10_000; i += 1) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('seed hashing and ids', () => {
  it('hashes a string to a fixed number', () => {
    expect(hashSeed('opendispatch')).toBe(2184523877);
    expect(hashSeed('opendispatch')).toBe(hashSeed('opendispatch'));
    expect(hashSeed('opendispatch')).not.toBe(hashSeed('opendispatcH'));
  });

  it('makes stable version-4 shaped UUIDs', () => {
    expect(uuidFor('s', 'k', '1')).toBe('3cc8e46f-3495-49ed-ad0d-01f9e8a03a68');
    const id = uuidFor('seed', 'kind', 'key');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFor('seed', 'kind', 'key')).toBe(id);
    expect(uuidFor('seed', 'kind', 'other')).not.toBe(id);
  });
});

describe('Rng', () => {
  it('is deterministic per seed and label, and forks are independent of each other', () => {
    const a = makeRng('s', 'x');
    const b = makeRng('s', 'x');
    expect([a.next(), a.next(), a.int(1, 6)]).toEqual([b.next(), b.next(), b.int(1, 6)]);
    const c = makeRng('s', 'root');
    const f1 = c.fork('one').next();
    const f2 = c.fork('two').next();
    expect(f1).not.toBe(f2);
    expect(makeRng('s', 'root').fork('one').next()).toBe(f1);
  });

  it('shuffles without losing items', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const out = makeRng('s').shuffle([...items]);
    expect([...out].sort((x, y) => x - y)).toEqual(items);
  });
});

describe('determinism rules', () => {
  it('no generator source uses Math.random, Date.now or new Date() without arguments', () => {
    const roots = [path.join(here, '..'), here];
    const files = new Set<string>();
    for (const dir of roots) {
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.add(path.join(dir, f));
    }
    const offenders: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (/Math\.random\s*\(/.test(text)) offenders.push(`${file}: Math.random`);
      if (/Date\.now\s*\(/.test(text)) offenders.push(`${file}: Date.now`);
      if (/new Date\(\s*\)/.test(text)) offenders.push(`${file}: new Date()`);
    }
    expect(offenders).toEqual([]);
  });
});
