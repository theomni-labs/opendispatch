// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { checkEngineInvariants } from './invariants.js';
import {
  createAjv,
  getComponentSchema,
  getEngineSchema,
  listComponentSchemas,
  listEngineSchemas,
} from './schemas.js';

const hasRef = (node: unknown): boolean => {
  if (Array.isArray(node)) return node.some(hasRef);
  if (node && typeof node === 'object') {
    return Object.entries(node).some(([key, value]) => key === '$ref' || hasRef(value));
  }
  return false;
};

describe('contract schema access', () => {
  it('lists the authored component schemas', () => {
    const names = listComponentSchemas();
    expect(names).toEqual([...names].sort());
    for (const expected of ['Case', 'Assignment', 'Roster', 'Override', 'ForecastValue', 'AuditEvent', 'ApiError']) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain('assignment.output.schema');
  });

  it('returns fully dereferenced component schemas for ajv 2020', () => {
    const schema = getComponentSchema('Case');
    expect(hasRef(schema)).toBe(false);
    expect(() => createAjv().compile(schema)).not.toThrow();
  });

  it('rejects an unknown component name with a helpful message', () => {
    expect(() => getComponentSchema('Cas')).toThrow(/Unknown component schema/);
  });

  it('exposes the ten engine schemas', () => {
    expect(listEngineSchemas()).toHaveLength(10);
    const schema = getEngineSchema('forecaster.output') as { title: string };
    expect(schema.title).toBe('ForecasterOutput');
  });
});

describe('engine invariants', () => {
  it('accepts the shipped examples', () => {
    for (const name of listEngineSchemas()) {
      const schema = getEngineSchema(name) as { examples: unknown[] };
      for (const example of schema.examples) expect(checkEngineInvariants(name, example)).toEqual([]);
    }
  });

  it('flags low > expected in a forecast', () => {
    const schema = getEngineSchema('forecaster.output') as { examples: { values: Record<string, number>[] }[] };
    const broken = structuredClone(schema.examples[0]);
    const first = broken?.values[0];
    if (!first) throw new Error('example has no values');
    first['low'] = 99;
    expect(checkEngineInvariants('forecaster.output', broken).join(' ')).toMatch(/low <= expected <= high/);
  });

  it('flags a gap cell whose kind disagrees with delta', () => {
    const schema = getEngineSchema('optimizer.output') as { examples: { gap_cells: Record<string, unknown>[] }[] };
    const broken = structuredClone(schema.examples[0]);
    const cell = broken?.gap_cells[0];
    if (!cell) throw new Error('example has no gap cells');
    cell['kind'] = 'surplus';
    expect(checkEngineInvariants('optimizer.output', broken).join(' ')).toMatch(/does not match delta/);
  });
});
