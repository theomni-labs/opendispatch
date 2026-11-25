// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixtures = path.join(repoRoot, 'fixtures');
// Samples are static files of the web app.
const publicDir = path.join(repoRoot, 'apps', 'web', 'public');
const committedPath = (f: string): string => path.join(f.startsWith('samples/') ? publicDir : fixtures, f);
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

function generateInFreshProcess(outDir: string): void {
  execFileSync(tsx, [path.join(here, 'generate.ts'), '--out', outDir], { cwd: repoRoot, stdio: 'pipe', env: { ...process.env, TZ: 'UTC' } });
}

describe('generate.ts', () => {
  it(
    'writes byte-identical files when run twice in fresh processes (even with another machine time zone)',
    () => {
      const a = fs.mkdtempSync(path.join(os.tmpdir(), 'opendispatch-fx-a-'));
      const b = fs.mkdtempSync(path.join(os.tmpdir(), 'opendispatch-fx-b-'));
      try {
        generateInFreshProcess(a);
        execFileSync(tsx, [path.join(here, 'generate.ts'), '--out', b], { cwd: repoRoot, stdio: 'pipe', env: { ...process.env, TZ: 'Pacific/Auckland' } });
        const filesA = listFiles(a);
        expect(filesA).toEqual(listFiles(b));
        expect(filesA.length).toBeGreaterThan(50);
        const different = filesA.filter((f) => !fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
        expect(different).toEqual([]);
        // The committed fixtures are what the generator writes now.
        const committed = [...listFiles(fixtures), ...listFiles(path.join(publicDir, 'samples')).map((f) => `samples/${f}`)].sort();
        expect(committed).toEqual(filesA);
        const stale = filesA.filter((f) => !fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(committedPath(f))));
        expect(stale, 'fixtures/ is out of date: run pnpm generate:fixtures').toEqual([]);
      } finally {
        fs.rmSync(a, { recursive: true, force: true });
        fs.rmSync(b, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it('keeps the committed fixtures under the size budget', () => {
    let bytes = 0;
    for (const f of listFiles(fixtures)) bytes += fs.statSync(path.join(fixtures, f)).size;
    expect(bytes / 1024 / 1024).toBeLessThan(25);
  });
});
