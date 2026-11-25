// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Rules 1 and 2 for this screen, checked on the files themselves (ESLint's banned-import rule is the gate; this proves the
// split): the client files never touch the data layer, the fixtures or Node; the Server Component and the view read through
// lib/data only; the one server action file is the only one that writes.

const here = import.meta.dirname;
const read = (name: string) => fs.readFileSync(path.join(here, name), 'utf8');
const sources = fs.readdirSync(here).filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name));
const isClient = (text: string) => /^\s*['"]use client['"]/.test(text);
const importsOf = (text: string) => [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the Data Import and Quality Admin screen: what is a client file, what is not', () => {
  const clientFiles = sources.filter((name) => isClient(read(name)));

  it('has client files for the header, the three tabs, and a Server Component for the screen', () => {
    expect(clientFiles.sort()).toEqual(['ImportHeader.tsx', 'ImportTab.tsx', 'IssuesHelp.tsx', 'IssuesTab.tsx', 'JobsTab.tsx', 'MappingHelp.tsx', 'useChunkedUpload.ts', 'useImportStep.ts']);
    expect(isClient(read('Screen.tsx'))).toBe(false);
    expect(read('Screen.tsx')).toMatch(/export async function DataImportQualityScreen/);
  });

  // The browser-side module: chunks to our route.
  const BROWSER_DATA = '@/lib/data/import-upload-client';

  it('imports nothing from the data layer, the fixtures, the store, Node or the request context in any client file', () => {
    for (const name of clientFiles) {
      const bad = importsOf(read(name)).filter((spec) => spec !== BROWSER_DATA && /lib\/data|fixtures|\.demo-state|internal\/|^node:|^(fs|path|os|crypto)$|next\/headers|next\/cache|run-action/.test(spec));
      expect(bad, name).toEqual([]);
    }
  });

  it('the browser-side upload module reaches only this site and imports no server code', () => {
    const text = read('../../../lib/data/import-upload-client.ts');
    expect(importsOf(text).every((spec) => spec.startsWith('@/lib/actions/'))).toBe(true);
    expect(text.match(/\bfetch\(/g)).toHaveLength(1);
    expect(text).toMatch(/fetch\(chunkPath\(uploadId, index\)/);
    expect(text).toMatch(/`\/api\/import-uploads\//);
  });

  it('reaches the server only through the actions file', () => {
    const serverCalls = clientFiles.flatMap((name) => importsOf(read(name)).filter((spec) => /actions$/.test(spec)));
    expect([...new Set(serverCalls)].sort()).toEqual(['./actions']);
  });

  it('never gives a client component the request context: no `ctx` prop or parameter in a client file', () => {
    for (const name of clientFiles) expect(stripComments(read(name)), name).not.toMatch(/\bctx\b/);
  });

  it('reads through lib/data in exactly two files: view.ts (reads) and actions.ts (writes), never an internal or test module (the upload hook only sends chunks)', () => {
    const dataUsers = sources.filter((name) => importsOf(read(name)).some((spec) => /lib\/data/.test(spec) && spec !== BROWSER_DATA));
    expect(dataUsers.sort()).toEqual(['actions.ts', 'view.ts']);
    for (const name of dataUsers) expect(importsOf(read(name)).filter((spec) => /lib\/data/.test(spec) && /internal|test-support/.test(spec)), name).toEqual([]);
  });

  it('has one use-server file, and it is actions.ts', () => {
    expect(sources.filter((name) => /^\s*['"]use server['"]/.test(read(name)))).toEqual(['actions.ts']);
  });

  it('formats no date by hand: no toLocale*, no Intl.DateTimeFormat in the screen files', () => {
    for (const name of sources) expect(stripComments(read(name)), name).not.toMatch(/toLocale(Date|Time)?String|Intl\.DateTimeFormat/);
  });
});
