// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { assignRemoteReviewer } from '@/lib/data/remote';
import { loadRemotePerformanceView, loadRemoteQueueView, loadRemoteRosterView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Candidates come from Agent.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// Server side vs the real data layer and fixtures:
// the remote queue of 2026-09-12 as of the default
// replay clock (07:00), all waiting, the same
// scenario the mockup shows
// ops-remote-queue.html), from the real fixtures.

afterEach(() => {
});

function ctxOf(role: Role, zoneIds: string[] = []): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const lead = () => ctxOf('remote_team_lead');
const admin = () => ctxOf('administrator');

describe.skipIf(!hasApi)('loadRemoteQueueView (live, real api and Postgres)', () => {
  describe('the queue, its stats and the staffing chart', () => {
    it('shows the queue day, every item waiting at 07:00, and a 96-point staffing chart', async () => {
      const view = await loadRemoteQueueView(lead(), {}, 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.queueDateLabel).toMatch(/2026/);
      expect(view.asOfTimeLabel).toBe('07:00');
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.counts.waiting).toBeGreaterThan(20);
      expect(view.stats.waiting).toBe(view.counts.waiting);
      expect(view.rows.every((r) => r.status === 'waiting')).toBe(true);
      expect(view.rows.every((r) => r.caseTypeLabel !== '—')).toBe(true);
      expect(view.staffing.labels).toHaveLength(96);
      expect(view.staffing.planned).toHaveLength(96);
      expect(view.staffing.required).toHaveLength(96);
      expect(view.zoneOptions.length).toBeGreaterThan(0);
      expect(view.firstWaitingCaseId).not.toBeNull();
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it crosses to the client
    });

    it('filters by tab, zone and the wait threshold', async () => {
      const base = await loadRemoteQueueView(lead(), {}, 'en');
      const zone = base.zoneOptions.find((z) => base.rows.some((r) => r.zoneCode === z.value))!;
      const byZone = await loadRemoteQueueView(lead(), { zone: zone.value }, 'en');
      expect(byZone.rows.length).toBeGreaterThan(0);
      expect(byZone.rows.every((r) => r.zoneCode === zone.value)).toBe(true);

      const inReview = await loadRemoteQueueView(lead(), { tab: 'in_review' }, 'en');
      expect(inReview.rows.every((r) => r.status === 'in_review')).toBe(true);
      // counts read the whole queue, not the current tab
      expect(inReview.counts).toEqual(base.counts);

      const longWait = base.rows.filter((r) => (r.waitMinutes ?? 0) >= 240).length;
      const filtered = await loadRemoteQueueView(lead(), { wait: '240' }, 'en');
      expect(filtered.rows).toHaveLength(longWait);
    });

    it('searches the case number', async () => {
      const base = await loadRemoteQueueView(lead(), {}, 'en');
      const needle = (base.rows[0] as (typeof base.rows)[number]).caseNumber;
      const found = await loadRemoteQueueView(lead(), { q: needle.toLowerCase() }, 'en');
      expect(found.rows.some((r) => r.caseNumber === needle)).toBe(true);
    });
  });

  describe('the assign drawer', () => {
    it('offers candidates (never the case\'s own attending agent) only for a waiting case named by ?assign=', async () => {
      const view = await loadRemoteQueueView(lead(), {}, 'en');
      const waiting = view.rows.find((r) => r.canAssign)!;
      const opened = await loadRemoteQueueView(lead(), { assign: waiting.id }, 'en');
      expect(opened.drawer).toBeDefined();
      expect(opened.drawer?.caseId).toBe(waiting.id);
      expect(opened.drawer?.candidates.length).toBeGreaterThan(0);
    });

    it('shows no drawer once the case is no longer waiting, and none for an unknown id', async () => {
      const view = await loadRemoteQueueView(admin(), {}, 'en');
      const waiting = view.rows.find((r) => r.canAssign)!;
      const agent = (await loadRemoteQueueView(lead(), { assign: waiting.id }, 'en')).drawer!.candidates[0]!;
      await assignRemoteReviewer(lead(), waiting.id, { agent_id: agent.id });
      const afterAssign = await loadRemoteQueueView(lead(), { assign: waiting.id }, 'en');
      expect(afterAssign.drawer).toBeUndefined();
      expect((await loadRemoteQueueView(lead(), { assign: '00000000-0000-0000-0000-000000000000' }, 'en')).drawer).toBeUndefined();
    });
  });

  describe('the Roster and Performance tabs', () => {
    it('gives the Remote Team Lead the roster lines, shifts and the week from the remote reads', async () => {
      const view = await loadRemoteRosterView(lead(), { date: '2026-09-14' }, 'en');
      expect(view.lineSource).toBe('roster');
      expect(view.lines.length).toBeGreaterThan(5);
      expect(view.onShift).toBeGreaterThan(0);
      expect(view.fte).toBeGreaterThanOrEqual(view.onShift);
      expect(view.utilizationLabel).toMatch(/%$/);
      expect(view.shifts.length).toBeGreaterThan(0);
      expect(view.week).toHaveLength(7);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
      const home = await loadRemoteRosterView(lead(), { date: '2026-09-25' }, 'en');
      expect(home.lineSource).toBe('home_shifts');
      expect(home.lines.length).toBeGreaterThan(0);
    });

    it('fills the utilization and the reviewers from the productivity read', async () => {
      const view = await loadRemotePerformanceView(lead(), 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.handled).toBeGreaterThan(0);
      expect(view.utilizationLabel).toMatch(/%$/);
      expect(view.caseTypes.length).toBeGreaterThan(0);
      expect(view.hours.received).toHaveLength(24);
    });
  });

  // NOT COVERED: view.ts's `isEmpty` branch (no remote
  // case at all) has no test here — the fixtures
  // always hold one, and a screen may not remove
  // fixture rows to force it. Typed and
  // short; mirrors listRemoteQueue's own null-day
  // case, which remote.test.ts does cover.
});
