// SPDX-License-Identifier: AGPL-3.0-only
// Splits test files into pure (never reach lib/data, Go or Postgres) and live.
import fs from 'node:fs';
import path from 'node:path';

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js', '.mjs'];
const LIVE_MARKERS = /OPENDISPATCH_API_URL|DEMO_SESSION|resetGoTestState|hasApi|fetch\(/;
// lib/data files with no I/O but process.env
const PURE_DATA = new Set(['wording.ts', 'wording.test.ts']);

function resolveImport(webSrc: string, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(webSrc, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

export function listTestFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.next') walk(rel);
      } else if (/\.test\.tsx?$/.test(entry.name)) found.push(rel);
    }
  };
  for (const dir of ['apps/web/src', 'packages/ui/src', 'scripts', 'tools']) walk(dir);
  return found.sort();
}

export function classifyTests(root: string, files: readonly string[]): { pure: string[]; live: string[] } {
  const webSrc = path.join(root, 'apps/web/src');
  const memo = new Map<string, boolean>();
  const reachesLive = (file: string, seen: Set<string>): boolean => {
    if (file.includes('/lib/data/') && !PURE_DATA.has(path.basename(file))) return true;
    const known = memo.get(file);
    if (known !== undefined) return known;
    if (seen.has(file)) return false;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    let hit = LIVE_MARKERS.test(source);
    for (const m of source.matchAll(/(?:from|import\(|require\()\s*['"]([^'"]+)['"]/g)) {
      if (hit) break;
      const target = resolveImport(webSrc, file, m[1] ?? '');
      if (target !== null && reachesLive(target, seen)) hit = true;
    }
    memo.set(file, hit);
    return hit;
  };
  const pure: string[] = [];
  const live: string[] = [];
  for (const file of files) (reachesLive(path.join(root, file), new Set()) ? live : pure).push(file);
  return { pure, live };
}
