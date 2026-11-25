// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { loadLeavePlannerView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Zones/holidays is api-backed (api-backed), read only here.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// Server vs the real data layer and fixtures: 20
// leave requests (8 requested, 9 approved, 3
// declined), the same scenario the mockup shows
//.
// LeaveRequest is api-backed (Postgres, shared): other
// live files add disposable requests during the
// same run: counts below are floors, not exact.

afterEach(() => {
});

/** RD-N: zone of the one requested field row. */
const RD_N = 'eecf5c7f-237c-443c-b331-b75ba3fb26fc';

function ctxOf(role: Role, zoneIds: string[] = []): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const viewer = () => ctxOf('viewer_auditor');
const plannerRdN = () => ctxOf('planner', [RD_N]);

describe.skipIf(!hasApi)('loadLeavePlannerView (live, real api and Postgres)', () => {
  describe('the full picture (whole-install, view-only role)', () => {
    it('shows every request, its counts and stats, from the real fixtures', async () => {
      const view = await loadLeavePlannerView(viewer(), {}, 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.counts.requested).toBeGreaterThanOrEqual(8);
      expect(view.counts.approved).toBeGreaterThanOrEqual(9);
      expect(view.counts.declined).toBeGreaterThanOrEqual(3);
      expect(view.stats.pending).toBeGreaterThanOrEqual(8);
      expect(view.stats.approved).toBeGreaterThanOrEqual(9);
      expect(view.stats.newGapsIfApproved).toBeGreaterThanOrEqual(0);
      expect(view.stats.recommendedWindows).toBeGreaterThanOrEqual(0);
      expect(view.zoneOptions.length).toBeGreaterThan(0);
      expect(view.candidates.length).toBeGreaterThan(0);
      expect(view.candidates.every((c) => c.zoneCode !== '')).toBe(true);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it crosses to the client
    });

    it('defaults to the requested tab, at least 8 rows, none decidable by a view-only role', async () => {
      const view = await loadLeavePlannerView(viewer(), { tab: 'requested' }, 'en');
      expect(view.rows.length).toBeGreaterThanOrEqual(8);
      expect(view.rows.every((r) => r.status === 'requested')).toBe(true);
      expect(view.rows.every((r) => !r.canDecide)).toBe(true);
      expect(view.rows.every((r) => !r.own)).toBe(true); // every fixture row has no created_by
    });

    it('computes a real coverage effect for every row (chip, days affected)', async () => {
      const view = await loadLeavePlannerView(viewer(), { tab: 'requested' }, 'en');
      for (const row of view.rows) {
        expect(['remote', 'none', 'gaps', 'ok']).toContain(row.effect.chip);
        if (row.kind === 'remote') expect(row.effect.chip).toBe('remote');
        expect(row.effect.requiredByDay).toHaveLength(row.effect.daysAffected);
        expect(row.effect.plannedByDay).toHaveLength(row.effect.daysAffected);
      }
      const omar = view.rows.find((r) => r.code === 'SVR-RD-N-025');
      expect(omar).toBeDefined();
      expect(omar?.zoneCode).not.toBeNull();
    });

    it('filters by tab, zone, type and search', async () => {
      const approved = await loadLeavePlannerView(viewer(), { tab: 'approved' }, 'en');
      expect(approved.rows.length).toBeGreaterThanOrEqual(9);
      expect(approved.rows.every((r) => r.status === 'approved')).toBe(true);

      const declined = await loadLeavePlannerView(viewer(), { tab: 'declined' }, 'en');
      expect(declined.rows.length).toBeGreaterThanOrEqual(3);

      const annualOnly = await loadLeavePlannerView(viewer(), { tab: 'requested', type: 'annual' }, 'en');
      expect(annualOnly.rows.every((r) => r.leaveType === 'annual')).toBe(true);
      expect(annualOnly.rows.length).toBeGreaterThan(0);

      const remotePool = await loadLeavePlannerView(viewer(), { tab: 'requested', zone: 'remote' }, 'en');
      expect(remotePool.rows.every((r) => r.zoneCode === null)).toBe(true);
      expect(remotePool.rows.length).toBeGreaterThan(0);

      const found = await loadLeavePlannerView(viewer(), { tab: 'requested', q: 'svr-rd-n-025' }, 'en');
      expect(found.rows.some((r) => r.code === 'SVR-RD-N-025')).toBe(true);
    });
  });

  describe('zone scope and the decide gate', () => {
    it('a zone-scoped Planner sees only their own zone, and can decide its requested row', async () => {
      const view = await loadLeavePlannerView(plannerRdN(), { tab: 'requested' }, 'en');
      expect(view.rows.every((r) => r.zoneCode !== null)).toBe(true);
      const own = view.rows.find((r) => r.code === 'SVR-RD-N-025');
      expect(own).toBeDefined();
      expect(own?.canDecide).toBe(true);
      expect(view.windows.zones.every((z) => z.days.length === view.windows.days.length)).toBe(true);
    });

    it('the same Planner cannot see a remote-pool or another zone request', async () => {
      const view = await loadLeavePlannerView(plannerRdN(), {}, 'en');
      expect(view.rows.every((r) => r.zoneCode !== null)).toBe(true);
      expect(view.counts.requested + view.counts.approved + view.counts.declined).toBeLessThan(20);
    });
  });

  describe('leave windows', () => {
    it('4 real weeks, 28 days, per-zone rows the same length', async () => {
      const view = await loadLeavePlannerView(viewer(), {}, 'en');
      expect(view.windows.weekHeaders).toHaveLength(4);
      expect(view.windows.days).toHaveLength(28);
      for (const zone of view.windows.zones) expect(zone.days).toHaveLength(28);
      expect(view.windows.recommendedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('the drawer', () => {
    it('opens the request named by ?id=, none for an unknown id', async () => {
      const base = await loadLeavePlannerView(viewer(), { tab: 'requested' }, 'en');
      const targetId = base.rows[0]?.id ?? '';
      expect(targetId).not.toBe('');
      const opened = await loadLeavePlannerView(viewer(), { id: targetId }, 'en');
      expect(opened.drawer?.id).toBe(targetId);
      const missing = await loadLeavePlannerView(viewer(), { id: '00000000-0000-0000-0000-000000000000' }, 'en');
      expect(missing.drawer).toBeUndefined();
    });
  });
});
