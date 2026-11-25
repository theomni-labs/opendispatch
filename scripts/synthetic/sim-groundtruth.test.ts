// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAjv, getEngineSchema } from '../contracts/schemas';
import { makeCtx } from './gen/context';
import { GROUND_TRUTH_DAYS, groundTruthDay, groundTruthDays } from './sim-groundtruth';

const here = path.dirname(fileURLToPath(import.meta.url));
const engineData = path.resolve(here, '..', '..', 'engines', 'tests', 'data', 'sim_groundtruth');

type Req = { cases: Record<string, unknown>[]; roster: { assignments: Record<string, unknown>[] }; data_source: string };

describe('simulator ground truth', () => {
  const ctx = makeCtx();

  it('is a valid simulator.input with recorded outcomes on every field case', () => {
    const req = groundTruthDay(ctx, '2026-09-08') as unknown as Req;
    const validate = createAjv().compile(getEngineSchema('simulator.input'));
    expect(validate(req), JSON.stringify(validate.errors)).toBe(true);
    expect(req.data_source).toBe('SYNTHETIC');
    const field = req.cases.filter((c) => c['handling'] === 'field');
    expect(field.length).toBeGreaterThan(500);
    for (const c of field) {
      expect(c['actual_arrived_at']).toBeTypeOf('string');
      expect(c['actual_agent_id']).toBeTypeOf('string');
      expect(c['on_scene_seconds']).toBeGreaterThan(0);
    }
    expect(req.roster.assignments.length).toBeGreaterThan(100);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(groundTruthDay(ctx, '2026-09-15'))).toBe(JSON.stringify(groundTruthDay(makeCtx(), '2026-09-15')));
  });

  // The engines submodule is private; CI may not check it out.
  it.skipIf(!fs.existsSync(engineData))('matches the copy committed in the engines repository', () => {
    const days = groundTruthDays(ctx);
    expect(days).toHaveLength(GROUND_TRUTH_DAYS);
    for (const { date, request } of days) {
      const committed = zlib.gunzipSync(fs.readFileSync(path.join(engineData, `${date}.json.gz`))).toString('utf8');
      expect(committed).toBe(`${JSON.stringify(request)}\n`);
    }
  });
});
