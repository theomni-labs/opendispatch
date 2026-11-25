// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { loadBreakPlannerView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// Server side vs the real data layer and
// fixtures: Riyadh Central, a submitted roster
// for 2026-09-14 (Field Planner's own default
// day), 21 breaks already placed by the
// synthetic generator, real prayer times
// (computed, past the fixture's own range).

// Screens may not import lib/data/internal (opendispatch/no-banned-import), so this
// mirrors lib/data/test-support.ts's resetGoTestState() locally.
async function resetGoTestState(): Promise<void> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') return;
  try {
    await fetch(`${url}/_internal/test/reset`, { method: 'POST' });
  } catch {
    // best-effort
  }
}

beforeEach(async () => {
  await resetGoTestState();
});

const RD_C = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';
const RD_N = 'eecf5c7f-237c-443c-b331-b75ba3fb26fc';
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

function ctxOf(role: Role, zoneIds: string[] = [RD_C, RD_N]): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');

describe.skipIf(!hasApi)('loadBreakPlannerView (live, real api and Postgres)', () => {
  describe('defaulting and the day’s plan', () => {
    it('defaults to the zone with the most actionable roster and tomorrow, with a full break plan', async () => {
      const view = await loadBreakPlannerView(admin(), {}, 'en');
      expect(view.zone).toEqual({ id: RD_C, code: 'RD-C', name: 'Riyadh Central' });
      expect(view.date).toBe('2026-09-14');
      expect(view.prevDate).toBe('2026-09-13');
      expect(view.nextDate).toBe('2026-09-15');
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.roster).toBeDefined();
      const roster = view.roster!;
      expect(roster.editable).toBe(true);
      expect(roster.policy).toEqual({ mode: 'clear_of_prayer', windowMinutes: 30 });
      expect(roster.prayerChips).toHaveLength(5);
      expect(roster.prayerChips.map((p) => p.name)).toEqual(PRAYERS);
      expect(roster.prayers.length).toBeGreaterThanOrEqual(5);
      expect(roster.gridRows).toHaveLength(21);
      expect(roster.shifts.length).toBeGreaterThan(1);
      expect(roster.shifts.flatMap((s) => s.rowIds).sort()).toEqual(roster.gridRows.map((r) => r.id).sort());
      for (const [i, s] of roster.shifts.entries()) {
        expect(s.startMin).toBeLessThan(s.endMin);
        if (i > 0) expect(s.startMin).toBeGreaterThanOrEqual((roster.shifts[i - 1] as { startMin: number }).startMin);
      }
      expect(roster.rows).toHaveLength(21);
      expect(roster.stats.breaks).toBe(21);
      expect(roster.stats.conflicts).toBe(roster.conflictRows.length);
      expect(roster.stats.peak).toBeGreaterThan(0);
      expect(roster.coverageCost?.max_share).toBe(0.34);
      expect(roster.coverageCost?.expected_cases).toBeGreaterThanOrEqual(0);
      for (const row of roster.rows) {
        expect(row.prayerConflict === null || PRAYERS.includes(row.prayerConflict)).toBe(true);
        if (row.prayerConflict !== null) expect(row.overlapMinutes).toBeGreaterThan(0);
        expect(row.earliestMin).toBeLessThanOrEqual(row.latestMin);
      }
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it crosses to the client
    });

    it('switches zone through ?zone=, each with its own break plan', async () => {
      const view = await loadBreakPlannerView(admin(), { zone: RD_N }, 'en');
      expect(view.zone.id).toBe(RD_N);
      expect(view.roster).toBeDefined();
      expect(view.roster!.gridRows).toHaveLength(22);
    });

    it('says so when there is no roster for the zone and day', async () => {
      const view = await loadBreakPlannerView(admin(), { date: '2026-09-25' }, 'en');
      expect(view.roster).toBeUndefined();
      expect(view.date).toBe('2026-09-25');
    });

    it('every block of the grid rows is either a shift or a break of the roster date', async () => {
      const roster = (await loadBreakPlannerView(admin(), {}, 'en')).roster!;
      for (const row of roster.gridRows) {
        expect(row.blocks.length).toBeGreaterThanOrEqual(1);
        expect(row.blocks.some((b) => b.kind === 'shift')).toBe(true);
        for (const block of row.blocks) expect(block.from).toBeLessThan(block.to);
        for (const block of row.blocks) expect(block.selectable === true).toBe(block.kind !== 'shift');
      }
    });
  });
});
