// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Rule 1 for this screen (one read-only action: the
// The customer plan export, built in planExport.ts). Checked on the files (ESLint's
// banned-import rule is the gate, this proves the
// split): client files never touch lib/data,
// fixtures or Node; Server Component/view.ts read
// lib/data only.

const here = import.meta.dirname;
const read = (name: string) => fs.readFileSync(path.join(here, name), 'utf8');
const sources = fs.readdirSync(here).filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name));
const isClient = (text: string) => /^\s*['"]use client['"]/.test(text);
const importsOf = (text: string) => [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the Forecast Explorer screen: what is a client file, what is not', () => {
  const clientFiles = sources.filter((name) => isClient(read(name)));

  it('has client files for the picker, the map, the rules panel, the timeline, the forecast against actual and the header, and a Server Component for the screen', () => {
    expect(clientFiles.sort()).toEqual(['AccuracyCard.tsx', 'CellsToggle.tsx', 'DemandMap.tsx', 'HeaderActions.tsx', 'PickerBar.tsx', 'RulesPanel.tsx', 'TimelineChart.tsx']);
    expect(isClient(read('Screen.tsx'))).toBe(false);
    expect(isClient(read('AccuracySection.tsx'))).toBe(false);
    expect(read('Screen.tsx')).toMatch(/export async function ForecastExplorerScreen/);
  });

  it.each(['AccuracyCard.tsx', 'CellsToggle.tsx', 'DemandMap.tsx', 'HeaderActions.tsx', 'PickerBar.tsx', 'RulesPanel.tsx', 'TimelineChart.tsx'])(
    '%s imports nothing from the data layer, the fixtures, the store, Node or the request context',
    (name) => {
      const bad = importsOf(read(name)).filter((spec) => /lib\/data|fixtures|\.demo-state|internal\/|^node:|^(fs|path|os|crypto)$|next\/headers|next\/cache|run-action/.test(spec));
      expect(bad).toEqual([]);
    },
  );

  it('has one server action file: the plan export reads, and the only write is the backtest start', () => {
    expect(sources.filter((name) => /^\s*['"]use server['"]/.test(read(name)))).toEqual(['actions.ts']);
    expect(read('actions.ts')).not.toMatch(/create|update|delete|approve/i);
    expect(importsOf(read('actions.ts')).filter((spec) => /lib\/data/.test(spec))).toEqual(['@/lib/data/forecast-backtest']);
  });

  it('reaches the server only through the actions file', () => {
    const calls = clientFiles.flatMap((name) => importsOf(read(name)).filter((spec) => /actions$/.test(spec)));
    expect([...new Set(calls)]).toEqual(['./actions']);
  });

  it('never gives a client component the request context: no `ctx` prop or parameter in a client file', () => {
    for (const name of clientFiles) expect(stripComments(read(name)), name).not.toMatch(/\bctx\b/);
  });

  it('reads through lib/data in insight.ts, view.ts, accuracyView.ts and planExport.ts (WhyCard takes only the context type), and writes in actions.ts, never an internal or test module', () => {
    const dataUsers = sources.filter((name) => importsOf(read(name)).some((spec) => /lib\/data/.test(spec)));
    expect(dataUsers).toEqual(['WhyCard.tsx', 'accuracyView.ts', 'actions.ts', 'insight.ts', 'planExport.ts', 'view.ts']);
    expect(importsOf(read('WhyCard.tsx')).filter((spec) => /lib\/data/.test(spec))).toEqual(['@/lib/data/guard']);
    expect(read('WhyCard.tsx')).toMatch(/import type \{ RequestContext \} from '@\/lib\/data\/guard'/);
    for (const name of dataUsers) expect(importsOf(read(name)).filter((spec) => /lib\/data/.test(spec) && /internal|test-support/.test(spec)), name).toEqual([]);
  });
});
