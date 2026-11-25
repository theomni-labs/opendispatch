// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The promises of the project rules, 26 and 29 for the shared blocks, checked on the files themselves. ESLint and Stylelint
// are the gates; this keeps the same promises in the unit tests and adds the checks they cannot make (which files are
// client files, and what the client files import).

const dir = path.dirname(fileURLToPath(import.meta.url));
const appSrc = path.resolve(dir, '../../..');
const tokensCss = readFileSync(path.resolve(dir, '../../../../../../packages/ui/src/styles/tokens.css'), 'utf8');

const files = (folder: string, pattern: RegExp) =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name) && !/\.test\./.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));

const patternSources = files(dir, /\.(ts|tsx)$/);
const isClient = (text: string) => /^\s*['"]use client['"]/.test(text);
const importsOf = (text: string) => [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string);

describe('the shared blocks and the client boundary', () => {
  const clientFiles = patternSources.filter((file) => isClient(readFileSync(file, 'utf8')));

  it('finds the client files (the check below is not vacuous)', () => {
    expect(clientFiles.map((f) => path.basename(f))).toEqual(expect.arrayContaining(['AdminTable.tsx', 'RecordDrawer.tsx', 'ListToolbar.tsx', 'useAdminAction.ts', 'useUrlState.ts']));
  });

  it.each(clientFiles.map((f) => [path.basename(f), f]))('%s imports nothing from the data layer, the fixtures, the store or Node', (_name, file) => {
    const imports = importsOf(readFileSync(file as string, 'utf8'));
    const bad = imports.filter((spec) => /(^|\/)lib\/data(\/|$)|fixtures|\.demo-state|(^|\/)internal\/|^node:|^(fs|path|os|crypto)$|next\/headers|next\/cache/.test(spec));
    expect(bad).toEqual([]);
  });

  it('has exactly one server-only file, and it says so: audit-actors.ts calls the data layer with the request context', () => {
    const dataUsers = patternSources.filter((file) => importsOf(readFileSync(file, 'utf8')).some((spec) => /lib\/data/.test(spec)));
    expect(dataUsers.map((f) => path.basename(f))).toEqual(['audit-actors.ts']);
    expect(isClient(readFileSync(dataUsers[0] as string, 'utf8'))).toBe(false);
    expect(readFileSync(dataUsers[0] as string, 'utf8')).toMatch(/SERVER ONLY/);
  });

  it('has no barrel file: importing one block must not pull the server-only helper into a client bundle', () => {
    expect(readdirSync(dir).filter((name) => /^index\.tsx?$/.test(name))).toEqual([]);
  });

  it('holds no state that is a role, customer, user or install mode: no prop of a client block is called that', () => {
    for (const file of clientFiles) {
      // Comments are documentation (a usage example may say `role: 'planner'` as a list filter); the code is what is checked.
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(text, path.basename(file)).not.toMatch(/\b(?:readonly\s+)?(?:role|customerId|tenantId|installMode|zoneScope|ctx)\??\s*:/);
    }
  });
});

describe('the server actions layer and the export helpers', () => {
  it('lib/actions has no use-server file: run-action.ts is imported by actions, it is not one', () => {
    for (const file of files(path.join(appSrc, 'lib/actions'), /\.ts$/)) expect(readFileSync(file, 'utf8'), path.basename(file)).not.toMatch(/^\s*['"]use server['"]/m);
  });

  it('lib/export imports nothing from the data layer', () => {
    for (const file of files(path.join(appSrc, 'lib/export'), /\.tsx?$/)) expect(importsOf(readFileSync(file, 'utf8')).filter((s) => /lib\/data/.test(s)), path.basename(file)).toEqual([]);
  });
});

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const PHYSICAL =
  /(?:^|[\s;{])(left|right|top|bottom|width|height|min-width|max-width|min-height|max-height|margin-(?:left|right|top|bottom)|padding-(?:left|right|top|bottom)|border-(?:left|right|top|bottom)(?:-[a-z]+)?|border-(?:top|bottom)-(?:left|right)-radius|overflow-[xy])\s*:/g;

describe.each(files(dir, /\.module\.css$/).map((f) => [path.basename(f), f]))('%s', (_name, file) => {
  const css = stripComments(readFileSync(file as string, 'utf8'));
  const component = readFileSync((file as string).replace(/\.module\.css$/, '.tsx'), 'utf8');

  it('uses logical properties only', () => {
    expect([...css.matchAll(PHYSICAL)].map((m) => m[1])).toEqual([]);
    expect(css).not.toMatch(/text-align\s*:\s*(left|right)\b|\b(float|clear)\s*:\s*(left|right)\b/);
  });

  it('has no raw colour, no pixel font size, no shadow and no !important', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch)\s*\(|font-size\s*:\s*[\d.]+px|(box|text)-shadow\s*:|!important|--tx-/);
  });

  it('reads only tokens the design system defines', () => {
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1] as string);
    expect(used.filter((token) => !new RegExp(`${token}\\s*:`).test(tokensCss))).toEqual([]);
  });

  it('defines every class the component uses, and the component uses every class it defines', () => {
    const defined = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1] as string));
    const used = new Set([...component.matchAll(/styles\.([A-Za-z]\w*)/g)].map((m) => m[1] as string));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });
});
