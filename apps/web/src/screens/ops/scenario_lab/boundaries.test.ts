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

describe('the Scenario Lab screen: what is a client file, what is not', () => {
  const clientFiles = sources.filter((name) => isClient(read(name)));

  it('has client files for the header, templates, editor, heat grid and table; a Server Component for the screen and the comparison panel', () => {
    expect(clientFiles.sort()).toEqual(['ComparisonHeat.tsx', 'Editor.tsx', 'HeaderActions.tsx', 'SavedScenariosTable.tsx', 'TemplateCards.tsx', 'Workspace.tsx']);
    expect(isClient(read('Screen.tsx'))).toBe(false);
    expect(isClient(read('ComparisonPanel.tsx'))).toBe(false);
    expect(read('Screen.tsx')).toMatch(/export async function ScenarioLabScreen/);
  });

  it.each(['ComparisonHeat.tsx', 'Editor.tsx', 'HeaderActions.tsx', 'SavedScenariosTable.tsx', 'TemplateCards.tsx', 'Workspace.tsx'])(
    '%s imports nothing from the data layer, the fixtures, the store, Node or the request context',
    (name) => {
      const bad = importsOf(read(name)).filter((spec) => /lib\/data|fixtures|\.demo-state|internal\/|^node:|^(fs|path|os|crypto)$|next\/headers|next\/cache|run-action/.test(spec));
      expect(bad).toEqual([]);
    },
  );

  it('reaches the server only through the actions file', () => {
    const serverCalls = clientFiles.flatMap((name) => importsOf(read(name)).filter((spec) => /actions$/.test(spec)));
    expect([...new Set(serverCalls)].sort()).toEqual(['./actions']);
  });

  it('never gives a client component the request context: no `ctx` prop or parameter in a client file', () => {
    for (const name of clientFiles) expect(stripComments(read(name)), name).not.toMatch(/\bctx\b/);
  });

  it('reads through lib/data in exactly two files: view.ts (reads) and actions.ts (writes), never an internal or test module', () => {
    const dataUsers = sources.filter((name) => importsOf(read(name)).some((spec) => /lib\/data/.test(spec)));
    expect(dataUsers.sort()).toEqual(['actions.ts', 'view.ts']);
    for (const name of dataUsers) expect(importsOf(read(name)).filter((spec) => /lib\/data/.test(spec) && /internal|test-support/.test(spec)), name).toEqual([]);
  });

  it('has one use-server file, and it is actions.ts', () => {
    expect(sources.filter((name) => /^\s*['"]use server['"]/.test(read(name)))).toEqual(['actions.ts']);
  });

  it('types.ts imports nothing from lib/data (a client file may import a value from it safely)', () => {
    expect(importsOf(read('types.ts')).filter((spec) => /lib\/data/.test(spec))).toEqual([]);
  });

  it('every client file that imports view.ts imports only its types, never a plain value', () => {
    const typeOnlyImport = /import\s+type\s*\{[^}]*\}\s*from\s*['"]\.\/view['"]/g;
    const anyImport = /import\s*(?:type\s*)?\{[^}]*\}\s*from\s*['"]\.\/view['"]/g;
    for (const name of clientFiles) {
      const text = read(name);
      const typeOnly = [...text.matchAll(typeOnlyImport)].length;
      const any = [...text.matchAll(anyImport)].length;
      if (any > 0) expect(typeOnly, name).toBe(any);
    }
  });
});
