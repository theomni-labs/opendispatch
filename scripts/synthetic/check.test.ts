// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeCheck, ramadanChart, writeCharts } from './check';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('calibration check', () => {
  const result = computeCheck();
  const byName = (name: string): { actual: string; pass: boolean } => {
    const row = [...result.rows, ...result.extras].find((r) => r.name === name);
    if (row === undefined) throw new Error(`No row ${name}`);
    return row;
  };

  it('recomputes every numeric target from the fixtures, and they all pass', () => {
    expect(result.rows.length).toBeGreaterThanOrEqual(20);
    const failed = [...result.rows, ...result.extras].filter((r) => !r.pass).map((r) => `${r.name}: ${r.actual}`);
    expect(failed).toEqual([]);
  });

  it('hits the headline numbers', () => {
    expect(result.totalCases).toBe(10500);
    expect(Number.parseFloat(byName('Share with no agent sent (remote)').actual)).toBeGreaterThan(35);
    expect(Number.parseFloat(byName('Share with no agent sent (remote)').actual)).toBeLessThan(41);
    expect(Number.parseFloat(byName('Assigned to arrived, median (min)').actual)).toBeGreaterThan(9.45);
    expect(Number.parseFloat(byName('Assigned to arrived, median (min)').actual)).toBeLessThan(11.55);
    expect(Number.parseFloat(byName('Late night: 00:00 hour vs 06:00 hour').actual)).toBeCloseTo(0.6, 1);
  });

  it('prints the two arrival figures and the case-type mix', () => {
    expect(byName('Arrived within 10 min of assignment').pass).toBe(true);
    expect(byName('Arrived within 10 min of registration').pass).toBe(true);
    expect(result.caseTypeMix.map((m) => m.name).sort()).toEqual(['Police attended', 'Standard case', 'Unlisted']);
  });

  it('fails a check when a fixture drifts (the check is not decorative)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendispatch-check-'));
    try {
      fs.cpSync(path.join(here, '..', '..', 'fixtures'), dir, { recursive: true });
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { files: { path: string; schema: string }[] };
      // Turn every remote case into a field case with plausible times: the remote share collapses.
      for (const e of manifest.files.filter((f) => f.schema === 'Case')) {
        const rows = JSON.parse(fs.readFileSync(path.join(dir, e.path), 'utf8')) as Record<string, unknown>[];
        for (const r of rows) {
          if (r['handling'] === 'field') continue;
          r['handling'] = 'field';
          r['assigned_at'] = r['registered_at'];
          r['arrived_at'] = r['closed_at'];
        }
        fs.writeFileSync(path.join(dir, e.path), JSON.stringify(rows));
      }
      const drifted = computeCheck(dir);
      expect(drifted.rows.some((r) => !r.pass)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('writes hand-written SVG charts, including the Ramadan profile, without touching fixtures', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendispatch-charts-'));
    try {
      const written = writeCharts(result, dir, { ramadan: true });
      expect(written.map((w) => path.basename(w)).sort()).toEqual(['cases-per-weekday.svg', 'daily-shape.svg', 'ramadan-profile.svg']);
      for (const w of written) {
        const svg = fs.readFileSync(w, 'utf8');
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).toContain('Illustrative');
        expect(svg).not.toContain('<script');
      }
      expect(ramadanChart()).toContain('iftar');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
