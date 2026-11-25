// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEngineInvariants } from './invariants.js';
import { ENGINES_DIR, REPO_ROOT, createAjv, getEngineSchema } from './schemas.js';

const EXAMPLES = join(ENGINES_DIR, 'examples');
const ENGINES = ['forecaster', 'optimizer', 'simulator', 'assignment'] as const;
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const ids = (file: string): Set<string> =>
  new Set((read(join(REPO_ROOT, 'fixtures', file)) as { id: string }[]).map((r) => r.id));

describe('engine input examples', () => {
  it('has exactly one example per engine input', () => {
    expect(readdirSync(EXAMPLES).sort()).toEqual(ENGINES.map((e) => `${e}.input.json`).sort());
  });

  for (const engine of ENGINES) {
    it(`${engine}.input.json validates against its schema`, () => {
      const validate = createAjv().compile(getEngineSchema(`${engine}.input`));
      const example = read(join(EXAMPLES, `${engine}.input.json`));
      const ok = validate(example);
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
      expect(checkEngineInvariants(`${engine}.input`, example)).toEqual([]);
    });
  }

  it('uses ids from the synthetic fixtures and is labelled SYNTHETIC', () => {
    const zones = ids('locations/zones.json');
    const agents = ids('people/agents.json');
    const sim = read(join(EXAMPLES, 'simulator.input.json')) as {
      data_source: string;
      cases: { zone_id: string }[];
      roster: { assignments: { agent_id: string }[] };
    };
    expect(sim.data_source).toBe('SYNTHETIC');
    for (const c of sim.cases) expect(zones.has(c.zone_id)).toBe(true);
    for (const a of sim.roster.assignments) expect(agents.has(a.agent_id)).toBe(true);
  });

  it('keeps the assignment deadline at the 2000 ms assumption', () => {
    const doc = read(join(EXAMPLES, 'assignment.input.json')) as { decision_deadline_ms: number };
    expect(doc.decision_deadline_ms).toBe(2000);
  });
});

describe('engine output fixtures', () => {
  for (const engine of ['forecaster', 'optimizer', 'simulator'] as const) {
    it(`${engine}.output fixture validates and satisfies invariants`, () => {
      const validate = createAjv().compile(getEngineSchema(`${engine}.output`));
      const doc = read(join(REPO_ROOT, 'fixtures', 'engines', `${engine}.output.json`));
      expect(validate(doc)).toBe(true);
      expect(checkEngineInvariants(`${engine}.output`, doc)).toEqual([]);
    });
  }
});
