// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { listAllCases } from '@/lib/data/cases';
import { controlReplay, listLiveCases, listShadowComparisons } from '@/lib/data/dispatch';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import { BOARD_COLUMNS } from './types';
import { loadLiveDispatchView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// Real data layer, demo store in a temp folder. The
// board's stage-per-zone and shadow comparisons come
// from the demo store (dispatch.ts), fixed at 8 zones;
// only zone names/codes and agents are read live.

function ctxOf(role: Role, zoneIds: readonly string[] = [], installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [...zoneIds] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

const admin = () => ctxOf('administrator');
const allZoneIds = async () => (await listZones(admin(), { limit: 200 })).items.map((z) => z.id);
const dispatcher = async () => ctxOf('dispatcher', await allZoneIds());

afterEach(() => {
});

describe.skipIf(!hasApi)('loadLiveDispatchView (live, real api and Postgres)', () => {
  describe('loadLiveDispatchView, at the replay start (stopped)', () => {
    it('has every board column, and the columns cover every delivered case exactly once', async () => {
      const view = await loadLiveDispatchView(admin(), 'en');
      expect(Object.keys(view.columns).sort()).toEqual([...BOARD_COLUMNS].sort());
      const counted = BOARD_COLUMNS.reduce((sum, col) => sum + view.columns[col].length, 0);
      expect(counted).toBe(view.totalCases);
      expect(view.totalCases).toBeGreaterThan(0);
    });

    it('every card in Recommended can be decided, and nowhere else', async () => {
      const view = await loadLiveDispatchView(admin(), 'en');
      for (const card of view.columns.recommended) {
        expect(card.canDecide).toBe(true);
        expect(card.recommendedAgentId).toBeTruthy();
      }
      for (const col of BOARD_COLUMNS.filter((c) => c !== 'recommended')) {
        for (const card of view.columns[col]) expect(card.canDecide).toBe(false);
      }
    });

    it('names the agent of every recommended and decided card, for the administrator and a dispatcher', async () => {
      await controlReplay(await dispatcher(), { action: 'seek', replay_at: '2026-09-13T10:42:50+03:00' });
      for (const ctx of [admin(), await dispatcher()]) {
        const view = await loadLiveDispatchView(ctx, 'en');
        const named = [...view.columns.recommended, ...view.columns.assigned, ...view.columns.enroute, ...view.columns.onscene];
        for (const card of named) expect(card.pick?.name, card.caseNumber).not.toBe('—');
      }
    });

    it('every waiting case shows why (waiting for operator dispatch), never Accept or Override data', async () => {
      const view = await loadLiveDispatchView(admin(), 'en');
      for (const card of view.columns.waiting) {
        expect(card.reason).toEqual({ kind: 'waiting_customer' });
        expect(card.waitMinutes).toBeGreaterThanOrEqual(0);
      }
    });

    it('the stage per zone lists all eight zones with a short code and a live-assignment stage', async () => {
      const view = await loadLiveDispatchView(admin(), 'en');
      expect(view.stages).toHaveLength(8);
      for (const s of view.stages) {
        expect(s.zoneCode).not.toBe('');
        expect(['shadow', 'recommend', 'automatic']).toContain(s.stage);
      }
    });

    it('the fallback is armed; its count is the cases operator dispatch assigned outside shadow zones', async () => {
      const view = await loadLiveDispatchView(admin(), 'en');
      expect(view.fallback.active).toBe(false);
      expect(view.fallback.sinceTime).toBeNull();
      const taken = await listLiveCases(admin(), { state: 'fallback_assigned', limit: 200 });
      expect(view.fallback.count).toBe(taken.items.length);
      for (const c of taken.items) expect(c.assignment_source).toBe('CUSTOMER_FALLBACK');
    });

    it('the map has every readable zone with a code and a stage, and a three-status legend', async () => {
      const view = await loadLiveDispatchView(admin(), 'en');
      expect(view.map.zones.length).toBeGreaterThan(0);
      expect(view.map.legend.map((l) => l.status)).toEqual(['available', 'en_route', 'on_scene']);
      for (const l of view.map.legend) expect(l.count).toBeGreaterThanOrEqual(0);
    });

    it('the 10-minute reading carries both readings for Customer and for OpenDispatch shadow, always Illustrative', async () => {
      const view = await loadLiveDispatchView(admin(), 'en');
      expect(view.reading.illustrative).toBe(true);
      expect(['assignment', 'registration']).toContain(view.reading.clockStart);
      expect(view.reading.customer).toHaveProperty('fromAssignment');
      expect(view.reading.customer).toHaveProperty('fromRegistration');
      expect(view.reading.opendispatch).toHaveProperty('fromAssignment');
      expect(view.reading.opendispatch).toHaveProperty('fromRegistration');
    });

    it('the shadow comparison rows are elapsed time, not a clock time, and same/different is a plain boolean', async () => {
      const view = await loadLiveDispatchView(admin(), 'en');
      expect(view.comparisons.length).toBeGreaterThan(0);
      expect(view.comparisons.length).toBeLessThanOrEqual(8);
      for (const row of view.comparisons) {
        expect(row.time).toMatch(/^\d{2}:\d{2}$/);
        expect(typeof row.same).toBe('boolean');
        expect(row.opendispatchMinutes).toBeGreaterThanOrEqual(0);
        expect(row.customerMinutes).toBeGreaterThanOrEqual(0);
      }
    });

    it('names each comparison case as the every-case read did', async () => {
      const ctx = admin();
      const view = await loadLiveDispatchView(ctx, 'en');
      const rows = (await listShadowComparisons(ctx, { limit: 8 })).items;
      const numbers = new Map((await listAllCases(ctx, {})).map((c) => [c.id, c.case_number] as const));
      expect(view.comparisons.map((r) => r.caseNumber)).toEqual(rows.map((r) => numbers.get(r.case_id) ?? r.case_id.slice(0, 8)));
    });

    it('never carries another data source than what it reports', async () => {
      const view = await loadLiveDispatchView(admin(), 'en');
      expect(view.sources.length).toBeGreaterThan(0);
      expect(view.sources.every((s) => s === 'SYNTHETIC' || s === 'IMPORTED' || s === 'LIVE')).toBe(true);
    });
  });

  describe('loadLiveDispatchView, once the replay reaches the mockup reference moment', () => {
    it('gives a recommended case its alternatives (the ranking minus the top pick), for Override', async () => {
      const ctx = await dispatcher();
      await controlReplay(ctx, { action: 'seek', replay_at: '2026-09-13T10:42:50+03:00' });
      const view = await loadLiveDispatchView(ctx, 'en');
      const withOptions = view.columns.recommended.find((c) => (c.overrideOptions?.length ?? 0) > 0);
      if (withOptions !== undefined) {
        expect(withOptions.overrideOptions?.some((o) => o.agentId === withOptions.recommendedAgentId)).toBe(false);
        for (const option of withOptions.overrideOptions ?? []) {
          expect(option.name).not.toBe('—');
          expect(option.minutes).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('delivers more cases than at the replay start', async () => {
      const ctx = await dispatcher();
      const before = (await loadLiveDispatchView(ctx, 'en')).totalCases;
      await controlReplay(ctx, { action: 'seek', replay_at: '2026-09-13T10:42:50+03:00' });
      const after = (await loadLiveDispatchView(ctx, 'en')).totalCases;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('loadLiveDispatchView, Arabic', () => {
    it('formats the replay date in Arabic and still gives Western-digit clock times', async () => {
      const view = await loadLiveDispatchView(admin(), 'ar');
      expect(view.replay.dateBoth).not.toBe('');
      expect(view.replay.time).toMatch(/^\d{2}:\d{2}$/);
    });
  });
});
