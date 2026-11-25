// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The data layer and both shells import this folder, so it must stay framework-free: source files
// import only each other, by relative path. Tests may also import vitest.
const dir = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
const sourceFiles = files.filter((f) => !f.endsWith('.test.ts'));

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  for (const match of source.matchAll(/\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

describe('access module purity', () => {
  it('sees its own source files', () => {
    expect(sourceFiles).toEqual(expect.arrayContaining(['types.ts', 'modules.ts', 'matrix.ts', 'access.ts', 'index.ts']));
  });

  it.each(sourceFiles)('%s imports only relative files inside this folder', (file) => {
    const found = specifiers(readFileSync(`${dir}${file}`, 'utf8'));
    for (const specifier of found) {
      expect(specifier.startsWith('./'), `${file} imports "${specifier}"`).toBe(true);
      expect(specifier.includes('..'), `${file} imports "${specifier}"`).toBe(false);
    }
  });

  it('the checker itself finds imports (guards against a silent regex miss)', () => {
    const access = specifiers(readFileSync(`${dir}access.ts`, 'utf8'));
    expect(access).toEqual(expect.arrayContaining(['./matrix', './modules', './types']));
    expect(specifiers("import { x } from 'next/headers';\nexport * from 'react';")).toEqual(['next/headers', 'react']);
  });

  it('test files import only vitest, node:fs, node:url and this folder', () => {
    for (const file of files.filter((f) => f.endsWith('.test.ts'))) {
      for (const specifier of specifiers(readFileSync(`${dir}${file}`, 'utf8'))) {
        const ok = specifier.startsWith('./') || ['vitest', 'node:fs', 'node:url'].includes(specifier);
        expect(ok, `${file} imports "${specifier}"`).toBe(true);
      }
    }
  });
});
