// SPDX-License-Identifier: AGPL-3.0-only
// Fixture loader, used by test setup only.

import fs from 'node:fs';
import path from 'node:path';

let cachedRoot: string | undefined;

/** The repository root. */
export function repoRoot(): string {
  if (cachedRoot !== undefined) return cachedRoot;
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot find the repository root (pnpm-workspace.yaml) above ${process.cwd()}.`);
}

/** The fixtures; OPENDISPATCH_FIXTURES_DIR overrides. */
export function fixturesDir(): string {
  const override = process.env['OPENDISPATCH_FIXTURES_DIR'];
  return override !== undefined && override !== '' ? path.resolve(override) : path.join(repoRoot(), 'fixtures');
}

export interface ManifestEntry {
  readonly path: string;
  readonly schema: string;
  readonly kind: 'array' | 'object';
  readonly count: number;
}

const cache = new Map<string, { readonly dir: string; readonly value: unknown }>();

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

function cached<T>(key: string, load: () => T): T {
  const dir = fixturesDir();
  const hit = cache.get(key);
  if (hit !== undefined && hit.dir === dir) return hit.value as T;
  const value = load();
  cache.set(key, { dir, value });
  return value;
}

/** Forget everything read so far (tests, and after the generator has run). */
export function clearFixtureCache(): void {
  cache.clear();
}

export function readManifest(): readonly ManifestEntry[] {
  return cached('manifest', () => {
    const raw = readJson(path.join(fixturesDir(), 'manifest.json'));
    const entries = Array.isArray(raw) ? raw : (raw as { files?: unknown }).files;
    if (!Array.isArray(entries)) throw new Error('fixtures/manifest.json must be an array or { files: [...] }.');
    return entries as readonly ManifestEntry[];
  });
}

/** Every record of a schema, from all its array fixtures, in manifest order. Never mutate the result. */
export function fixtureRecords<T>(schema: string): readonly T[] {
  return cached(`array:${schema}`, () => {
    const out: T[] = [];
    for (const entry of readManifest()) {
      if (entry.schema !== schema || entry.kind !== 'array') continue;
      const rows = readJson(path.join(fixturesDir(), entry.path));
      if (!Array.isArray(rows)) throw new Error(`${entry.path} must hold a JSON array.`);
      out.push(...(rows as T[]));
    }
    return out;
  });
}

/** A single-object fixture (for example the settings defaults), or undefined when absent. */
export function fixtureObject<T>(schema: string): T | undefined {
  return cached(`object:${schema}`, () => {
    const entry = readManifest().find((e) => e.schema === schema && e.kind === 'object');
    return entry === undefined ? undefined : (readJson(path.join(fixturesDir(), entry.path)) as T);
  });
}

/** Every schema name the manifest mentions. */
export function fixtureSchemas(): readonly string[] {
  return [...new Set(readManifest().map((e) => e.schema))];
}
