// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// applyMoveAction moved to actions.live.test.ts.

describe('the server-built context rule in this file', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');

  it('is a use-server file: one function export, plus its own input type', () => {
    expect(source.trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported.filter((kind) => kind !== 'interface')).toEqual(['async']);
    expect(exported.filter((kind) => kind === 'interface')).toEqual(['interface']);
  });

  it('names no parameter called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) {
      expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
    }
  });
});
