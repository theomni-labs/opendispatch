// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Rules 1-2: no client file touches lib/data.

const here = import.meta.dirname;
const read = (name: string) => fs.readFileSync(path.join(here, name), 'utf8');
const sources = fs.readdirSync(here).filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name));
const isClient = (text: string) => /^\s*['"]use client['"]/.test(text);
const importsOf = (text: string) => [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Standby and Coverage Map: client vs server files', () => {
  const clientFiles = sources.filter((name) => isClient(read(name)));

  it('has client files for the map, the picker, the list, the move card, the header, and a server Screen', () => {
    expect(clientFiles.sort()).toEqual(['CoverageMap.tsx', 'HeaderActions.tsx', 'PickerBar.tsx', 'PointsList.tsx', 'RecommendedMove.tsx']);
    expect(isClient(read('Screen.tsx'))).toBe(false);
    expect(read('Screen.tsx')).toMatch(/export async function StandbyCoverageScreen/);
  });

  it.each(['CoverageMap.tsx', 'HeaderActions.tsx', 'PickerBar.tsx', 'PointsList.tsx', 'RecommendedMove.tsx'])(
    '%s imports nothing from the data layer, fixtures, the store, Node or the request context',
    (name) => {
      const bad = importsOf(read(name)).filter((spec) => /lib\/data|fixtures|\.demo-state|internal\/|^node:|^(fs|path|os|crypto)$|next\/headers|next\/cache|run-action/.test(spec));
      expect(bad).toEqual([]);
    },
  );

  it('reaches the server only through the actions file', () => {
    const serverCalls = clientFiles.flatMap((name) => importsOf(read(name)).filter((spec) => /actions$/.test(spec)));
    expect([...new Set(serverCalls)].sort()).toEqual(['./actions']);
  });

  it('never gives a client component the request context: no `ctx` in a client file', () => {
    for (const name of clientFiles) expect(stripComments(read(name)), name).not.toMatch(/\bctx\b/);
  });

  it('reads through lib/data in exactly two files: view.ts and actions.ts', () => {
    const dataUsers = sources.filter((name) => importsOf(read(name)).some((spec) => /lib\/data/.test(spec)));
    expect(dataUsers.sort()).toEqual(['actions.ts', 'view.ts']);
    for (const name of dataUsers) expect(importsOf(read(name)).filter((spec) => /lib\/data/.test(spec) && /internal|test-support/.test(spec)), name).toEqual([]);
  });

  it('has one use-server file, and it is actions.ts', () => {
    expect(sources.filter((name) => /^\s*['"]use server['"]/.test(read(name)))).toEqual(['actions.ts']);
  });

  it('every client file that imports view.ts does so type-only', () => {
    for (const name of clientFiles) {
      const text = read(name);
      for (const match of text.matchAll(/^import\s+([^;]+?)\s+from\s+['"]\.\/view['"]/gm)) {
        expect(match[1] as string, `${name}: ${match[0]}`).toMatch(/^type\s+\{/);
      }
    }
  });
});
