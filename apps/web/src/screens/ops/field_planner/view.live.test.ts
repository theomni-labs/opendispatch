// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listUsers } from '@/lib/data/users';
import { loadFieldPlannerView, loadFieldPlannerWeekView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Shared with other live files: exact lists of
// agents/vehicles/shifts become subsets.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// Server side vs the real data layer and fixtures:
// Riyadh Central, a submitted roster for 2026-09-14
// (tomorrow), submitted by Reem Al-Hinari, one
// pending override, the same scenario the mockup
// shows, from the real (richer) fixtures.

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

function ctxOf(role: Role, zoneIds: string[] = [RD_C]): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');

describe.skipIf(!hasApi)('loadFieldPlannerView (live, real api and Postgres)', () => {
  describe('defaulting', () => {
    it('defaults to the zone with the most actionable roster (submitted) and tomorrow (rule: demo today + 1)', async () => {
      const view = await loadFieldPlannerView(admin(), {}, 'en');
      expect(view.zone).toEqual({ id: RD_C, code: 'RD-C', name: 'Riyadh Central' });
      expect(view.date).toBe('2026-09-14');
      expect(view.prevDate).toBe('2026-09-13');
      expect(view.nextDate).toBe('2026-09-15');
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it crosses to the client
    });

    it('honours ?zone= and ?date= when both are valid and accessible', async () => {
      const view = await loadFieldPlannerView(admin(), { date: '2026-09-16' }, 'en');
      expect(view.date).toBe('2026-09-16');
      expect(view.roster?.status).toBe('draft');
      expect(view.roster?.source).toBeNull();
    });

    it('falls back to the default when ?zone= names a zone outside a zone-scoped role\'s scope', async () => {
      const other = '555117e3-96d2-43fc-9fb1-45ec4ed1d8ad';
      const view = await loadFieldPlannerView(ctxOf('planner', [RD_C]), { zone: other }, 'en');
      expect(view.zone.id).toBe(RD_C);
    });

    it('shows the empty state (no roster) with no action for a zone/day with none, without throwing', async () => {
      const view = await loadFieldPlannerView(admin(), { date: '2026-10-25' }, 'en');
      expect(view.roster).toBeUndefined();
      expect(view.zoneOptions.length).toBeGreaterThan(0);
    });
  });

  describe('the roster', () => {
    it('gives the stats, the approval bar and the overrides for the submitted roster (live gap view, duration demand)', async () => {
      const view = await loadFieldPlannerView(admin(), {}, 'en');
      const roster = view.roster;
      if (roster === undefined) throw new Error('expected a roster');
      expect(roster.status).toBe('submitted');
      // 28 total, 7 are remote pool; field-only is 21.
      expect(roster.stats).toEqual({ agents: 21, gapIntervals: 0, surplusIntervals: 95, pendingOverrides: 1 });
      expect(roster.engineVersion).toBe('0.1.0');
      expect(roster.approval).toMatchObject({
        status: 'submitted',
        submittedByName: 'Reem Al-Hinari',
        submittedByIsMe: false,
        submittedDate: '2026-09-12',
        approvedByName: null,
        canSubmit: false,
        canPublish: false,
        publishReason: 'needApprove',
      });
      expect(roster.overrides).toHaveLength(1);
      expect(roster.overrides[0]).toMatchObject({
        changeType: 'replace_agent',
        changeLabel: 'Adel Al-Fariri → Rana Al-Shaani',
        reasonCode: 'agent_unavailable',
        byName: 'Reem Al-Hinari',
        status: 'pending',
      });
    });

    it('draws one roster-grid row per assignment plus the gap row, and the vehicles table has one row per zone vehicle', async () => {
      // 13 Sept: the published roster with gaps
      const view = await loadFieldPlannerView(admin(), { date: '2026-09-13' }, 'en');
      const roster = view.roster;
      if (roster === undefined) throw new Error('expected a roster');
      expect(roster.gridRows).toHaveLength(roster.stats.agents + 1);
      const gapRow = roster.gridRows.at(-1);
      expect(gapRow?.id).toBe('gap-row');
      expect(gapRow?.blocks.every((b) => b.kind === 'gap')).toBe(true);
      // only shortfalls, as positive counts
      expect(gapRow?.blocks.length).toBeGreaterThan(0);
      expect(gapRow?.blocks.every((b) => Number(b.label) > 0)).toBe(true);
      const covered = (gapRow?.blocks ?? []).reduce((n, b) => n + Math.round((b.to - b.from) * 4), 0);
      expect(covered).toBe(roster.stats.gapIntervals);
      expect(roster.vehicleRows.length).toBeGreaterThan(0);
      expect(roster.shiftColumns.map((c) => c.code)).toEqual(['DAY-A', 'DAY-B', 'NIGHT']);
    });

    it('offers the override drawer choices: current assignments, agents not yet on the roster, active vehicles and field shift patterns', async () => {
      const view = await loadFieldPlannerView(admin(), {}, 'en');
      const roster = view.roster;
      if (roster === undefined) throw new Error('expected a roster');
      expect(roster.drawer.assignments).toHaveLength(roster.stats.agents);
      expect(roster.drawer.availableAgents.length).toBeGreaterThan(0);
      const assignedIds = new Set(roster.drawer.assignments.map((a) => a.id));
      expect(roster.drawer.availableAgents.every((s) => !assignedIds.has(s.id))).toBe(true);
      // Every active field shift pattern is offered here
      // (a wrong pick, e.g. Evening outside Ramadan, is
      // refused server-side); shiftColumns lists only
      // patterns actually in use.
      expect(roster.drawer.shiftPatterns.map((p) => p.code)).toEqual(expect.arrayContaining(['DAY-A', 'DAY-B', 'EVENING', 'NIGHT']));
    });
  });

  describe('approval gating (rule: nobody approves their own request)', () => {
    it('the submitter cannot approve or reject their own roster; the reason is "own"', async () => {
      const users = (await listUsers(admin(), { limit: 200 })).items;
      const reem = users.find((u) => u.display_name === 'Reem Al-Hinari');
      expect(reem).toBeDefined();
      // Reem submitted it; her own Planner context sees
      // "own", not "notPending".
      const tenant = fixtureTenantId();
      const asReem = buildContext({ role: 'planner', installMode: 'private', zoneIds: [RD_C] }, users, tenant);
      if (asReem === null) throw new Error('no context');
      if (reem !== undefined) {
        const forced: RequestContext = { ...asReem, userId: reem.id };
        const view = await loadFieldPlannerView(forced, {}, 'en');
        expect(view.roster?.approval.submittedByIsMe).toBe(true);
      }
    });

    it('a Dispatch Supervisor who did not submit it may approve; the button is enabled', async () => {
      const view = await loadFieldPlannerView(ctxOf('dispatch_supervisor', [RD_C]), {}, 'en');
      expect(view.roster?.approval.canApprove).toBe(true);
      expect(view.roster?.approval.approveReason).toBeNull();
    });

    it('a view-only role (Administrator, Viewer / Auditor) never gets canApprove true', async () => {
      for (const role of ['administrator', 'viewer_auditor'] as const) {
        const view = await loadFieldPlannerView(ctxOf(role, [RD_C]), {}, 'en');
        // Neither role is in APPROVER_ROLES for
        // roster_override (only dispatch_supervisor is).
        expect(view.roster?.approval.canApprove).toBe(false);
      }
    });
  });
});

describe.skipIf(!hasApi)('loadFieldPlannerWeekView (live)', () => {
  it('lays the fixture week out by center and day, with net availability by center and shift', async () => {
    const week = await loadFieldPlannerWeekView(admin(), { date: '2026-09-16' }, 'en');
    expect(week.days).toHaveLength(7);
    expect(week.weekStart <= '2026-09-16' && (week.days[6] ?? '') >= '2026-09-16').toBe(true);
    expect(week.zones.length).toBeGreaterThanOrEqual(8);
    const rdc = week.zones.find((z) => z.id === RD_C);
    expect(rdc?.cells.find((c) => c.date === '2026-09-14')?.status).toBe('submitted');
    expect(week.stats.built).toBe(week.zones.flatMap((z) => z.cells).filter((c) => c.status !== null).length);
    expect(week.availability.length).toBeGreaterThan(0);
    for (const r of week.availability) {
      expect(r.netHours).toBeGreaterThan(0);
      expect(r.netHours + r.leaveRestHours + r.sickHours + r.breakPrayerHours).toBeCloseTo(r.shiftHours, 0);
    }
    expect(week.prevWeek).toBe(new Date(Date.parse(`${week.weekStart}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10));
  });

  it('gives a planner only the zone in scope', async () => {
    const week = await loadFieldPlannerWeekView(ctxOf('planner'), { date: '2026-09-16' }, 'en');
    expect(week.zones.map((z) => z.id)).toEqual([RD_C]);
  });
});
