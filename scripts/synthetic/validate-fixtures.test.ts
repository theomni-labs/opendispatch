// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkEngineInvariants } from '../contracts/invariants';
import { listComponentSchemas, listEngineSchemas } from '../contracts/schemas';
import { readingInvariantProblems, validateFixtures } from './validate-fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '..', '..', 'fixtures');

describe('fixtures against the contracts', () => {
  it('every record validates and every integrity check holds', () => {
    const report = validateFixtures(fixtures);
    expect(report.errors).toEqual([]);
    expect(report.counts.reduce((a, c) => a + c.records, 0)).toBeGreaterThan(30000);
  }, 120_000);

  it('the manifest is complete: every file is listed, every count matches, every schema exists', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(fixtures, 'manifest.json'), 'utf8')) as { files: { path: string; schema: string; kind: string; count: number; contract_schema?: string }[] };
    const known = new Set([...listComponentSchemas(), ...listEngineSchemas(), 'ReplayCase', 'ReplayScript']);
    const onDisk: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name !== 'manifest.json' && e.name.endsWith('.json')) onDisk.push(path.relative(fixtures, full).split(path.sep).join('/')); // fixtures/samples/*.csv are not fixtures of a schema
      }
    };
    walk(fixtures);
    expect(manifest.files.map((f) => f.path).sort()).toEqual(onDisk.sort());
    for (const f of manifest.files) {
      expect(known.has(f.schema), `${f.path}: unknown schema ${f.schema}`).toBe(true);
      expect(['array', 'object']).toContain(f.kind);
      const data = JSON.parse(fs.readFileSync(path.join(fixtures, f.path), 'utf8')) as unknown;
      if (f.kind === 'array') expect((data as unknown[]).length, f.path).toBe(f.count);
      else expect(f.count, f.path).toBe(1);
    }
    // The case files are split per day, Sunday 6 to Saturday 12 September 2026.
    expect(manifest.files.filter((f) => f.schema === 'Case').map((f) => f.path)).toEqual(['cases/2026-09-06.json', 'cases/2026-09-07.json', 'cases/2026-09-08.json', 'cases/2026-09-09.json', 'cases/2026-09-10.json', 'cases/2026-09-11.json', 'cases/2026-09-12.json']);
    // Every table area of that has a fixture is present.
    const schemas = new Set(manifest.files.map((f) => f.schema));
    for (const need of ['City', 'Zone', 'SubZone', 'StandbyPoint', 'CaseType', 'Case', 'Agent', 'Vehicle', 'AgentSkill', 'LeaveRequest', 'ShiftPattern', 'BreakRule', 'ClassificationRule', 'RuleVersion', 'Approval', 'User', 'RoleMapping', 'Setting', 'Holiday', 'HijriMonth', 'PrayerTime', 'ForecastRun', 'ForecastValue', 'Roster', 'RosterAssignment', 'Override', 'Scenario', 'SimulationRun', 'SimulationResult', 'Assignment', 'AssignmentEvent', 'AssignmentComparison', 'Notification', 'Integration', 'ImportJob', 'DataQualityIssue', 'AuditEvent', 'forecaster.output', 'optimizer.output', 'simulator.output', 'assignment.output']) {
      expect(schemas.has(need), `missing fixtures for ${need}`).toBe(true);
    }
  });

  it('fails clearly when a record breaks the contract, a key dangles or a count is wrong', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendispatch-validate-'));
    try {
      fs.cpSync(fixtures, dir, { recursive: true });
      const casePath = path.join(dir, 'cases', '2026-09-06.json');
      const rows = JSON.parse(fs.readFileSync(casePath, 'utf8')) as Record<string, unknown>[];
      (rows[0] as Record<string, unknown>)['remote_flag'] = true; // not in the contract (and banned by the inferred handling rule)
      (rows[1] as Record<string, unknown>)['zone_id'] = '00000000-0000-4000-8000-000000000000'; // dangling
      (rows[2] as Record<string, unknown>)['tenant_id'] = '11111111-1111-4111-8111-111111111111'; // wrong customer
      rows.pop(); // count no longer matches the manifest
      fs.writeFileSync(casePath, JSON.stringify(rows));
      const messages = validateFixtures(dir).errors.join('\n');
      expect(messages).toMatch(/unevaluated properties/);
      expect(messages).toMatch(/is not a Zone id/);
      expect(messages).toMatch(/tenant_id/);
      expect(messages).toMatch(/manifest count/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('runs the shared engine invariants on every engine output and on the reading tables', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(fixtures, 'manifest.json'), 'utf8')) as { files: { path: string; schema: string; kind: string }[] };
    const engineNames = new Set(listEngineSchemas());
    const engineFiles = manifest.files.filter((f) => engineNames.has(f.schema));
    expect(engineFiles.map((f) => f.schema).sort()).toEqual(['assignment.output', 'forecaster.output', 'optimizer.output', 'simulator.output']);
    for (const f of engineFiles) {
      const parsed = JSON.parse(fs.readFileSync(path.join(fixtures, f.path), 'utf8')) as unknown;
      const docs = Array.isArray(parsed) ? parsed : [parsed];
      for (const doc of docs) expect(checkEngineInvariants(f.schema, doc, { complete: true }), f.path).toEqual([]);
    }
    for (const file of ['plans/simulation_results.json', ...manifest.files.filter((f) => f.path.startsWith('rollups/dashboard')).map((f) => f.path)]) {
      const rows = JSON.parse(fs.readFileSync(path.join(fixtures, file), 'utf8')) as Record<string, unknown>[];
      expect(readingInvariantProblems(rows), file).toEqual([]);
    }
  });

  it('catches a share rounded to 4 decimals (the regression this guards against)', () => {
    const reading = { within_count: 1, case_count: 3, share: 0.3333 };
    expect(readingInvariantProblems([{ from_registration: reading, from_assignment: { within_count: 0, case_count: 0, share: null } }])).toHaveLength(1);
    const ok = { within_count: 1, case_count: 3, share: 0.333333 };
    expect(readingInvariantProblems([{ from_registration: ok, from_assignment: ok }])).toEqual([]);
    const sim = JSON.parse(fs.readFileSync(path.join(fixtures, 'engines', 'simulator.output.json'), 'utf8')) as { overall: { from_registration: { share: number } } };
    sim.overall.from_registration.share = Math.round(sim.overall.from_registration.share * 100) / 100 + 0.0004;
    expect(checkEngineInvariants('simulator.output', sim).length).toBeGreaterThan(0);
  });
});
