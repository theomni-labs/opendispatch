// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { createForecastRun } from '@/lib/data/models';
import { approveRuleVersion, submitRuleVersion } from '@/lib/data/rules';
import { loadForecastExplorerView, localName } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// Server side vs the real data layer and fixtures:
// Riyadh (RD), Riyadh Central (16 sub-zones), demo
// "today" 2026-09-13, forecast run placeholder-0.1.

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

describe.skipIf(!hasApi)('loadForecastExplorerView (live, real api and Postgres)', () => {
  describe('defaulting', () => {
    it('in Riyadh it defaults to Riyadh Central, the run\'s first day (today is before it), and the peak interval', async () => {
      const view = await loadForecastExplorerView(admin(), { city: 'RD' }, 'en');
      expect(view.city).toBe('RD');
      expect(view.zone).toEqual({ id: RD_C, code: 'RD-C', name: 'Riyadh Central', fallback: false });
      expect(view.days.map((d) => d.value)).toEqual(['2026-09-14']);
      expect(view.day).toBe('2026-09-14');
      expect(view.subZones).toHaveLength(16);
      expect(view.time).toBe(view.stats.peakIndex);
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.hasForecast).toBe(true);
      expect(view.otherDay).toBeNull();
      expect(view.run?.rangeCoverage).toBe(0.8);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it crosses to the client
    });

    it('offers only the latest run\'s horizon: a day before it is not offered or used', async () => {
      await createForecastRun(admin(), { horizon_start_date: '2026-09-13', horizon_days: 10 });
      const view = await loadForecastExplorerView(admin(), { city: 'RD', day: '2026-09-10' }, 'en');
      expect(view.days).toHaveLength(10);
      expect(view.days[0]?.value).toBe('2026-09-13');
      expect(view.days[9]?.value).toBe('2026-09-22');
      expect(view.day).toBe('2026-09-13');
      expect(view.days[0]?.label).toBe('Sun 13');
      const ar = await loadForecastExplorerView(admin(), { city: 'RD', day: '2026-09-12' }, 'ar');
      expect(ar.days.map((d) => d.value)).not.toContain('2026-09-12');
      expect(ar.day).toBe('2026-09-13');
    });

    it('honours ?city= ?zone= ?sub= ?day= ?time= ?view= together', async () => {
      const view = await loadForecastExplorerView(admin(), { city: 'RD', day: '2026-09-14', time: 40, view: 'field' }, 'en');
      expect(view.day).toBe('2026-09-14');
      expect(view.time).toBe(40);
      expect(view.view).toBe('field');
    });

    it('an unknown ?sub= (not one of the zone\'s sub-zones) is ignored, not thrown', async () => {
      const view = await loadForecastExplorerView(admin(), { city: 'RD', sub: 'NOPE' }, 'en');
      expect(view.sub).toBe('');
    });
  });

  describe('the forecast run and the numbers', () => {
    it('gives the committed run, illustrative stats, a heat map and a busiest-5 list at the chosen time', async () => {
      const view = await loadForecastExplorerView(admin(), { city: 'RD' }, 'en');
      expect(view.run).toMatchObject({ version: 'placeholder-0.1' });
      expect(view.stats.expected).toBeGreaterThan(0);
      expect(view.stats.rangeLow).toBeLessThanOrEqual(view.stats.rangeHigh);
      expect(view.mapZones).toHaveLength(16);
      expect(view.mapZones.every((z) => z.heat >= 1 && z.heat <= 5)).toBe(true);
      expect(view.top).toHaveLength(5);
      expect(view.top[0]?.shareOfMax).toBe(1);
      expect(view.timeline.expected).toHaveLength(96);
    });

    it('selecting a sub-zone scopes the timeline to it (its total is a fraction of the zone total)', async () => {
      const zoneView = await loadForecastExplorerView(admin(), { city: 'RD' }, 'en');
      const busiest = zoneView.top[0];
      if (busiest === undefined) throw new Error('expected a top sub-zone');
      const subCode = zoneView.mapZones.find((z) => z.label === busiest.code.slice(-2))?.code ?? busiest.code;
      const subView = await loadForecastExplorerView(admin(), { city: 'RD', sub: subCode }, 'en');
      expect(subView.sub).toBe(subCode);
      expect(subView.stats.expected).toBeGreaterThan(0);
      expect(subView.stats.expected).toBeLessThan(zoneView.stats.expected);
    });

    it("the split bar of a sub-zone is the sub-zone's own and adds up to its expected cases", async () => {
      const zoneView = await loadForecastExplorerView(admin(), { city: 'RD' }, 'en');
      const sub = zoneView.mapZones[0]?.code;
      const subView = await loadForecastExplorerView(admin(), { city: 'RD', sub }, 'en');
      expect(subView.split.fieldExpected + subView.split.remoteExpected).toBe(subView.stats.expected);
      expect(subView.split.fieldExpected).toBeLessThan(zoneView.split.fieldExpected);
      const draft = await loadForecastExplorerView(admin(), { city: 'RD', sub, rules: 'draft' }, 'en');
      expect(draft.split.fieldExpected + draft.split.remoteExpected).toBe(draft.stats.expected);
    });
  });

  describe('the field/remote split and the draft preview', () => {
    it('a role with Classification Rules access gets the active/draft counts and may preview a draft', async () => {
      const view = await loadForecastExplorerView(admin(), { city: 'RD' }, 'en');
      expect(view.split.canPreviewDraft).toBe(true);
      expect(view.split.activeCount).toBeGreaterThan(0);
      expect(view.split.fieldExpected).toBeGreaterThan(0);
      expect(view.canOpenClassificationRules).toBe(true);
    });

    it('previewing a draft (?rules=draft) moves the split and counts one more rule as active', async () => {
      const activeView = await loadForecastExplorerView(admin(), { city: 'RD' }, 'en');
      const draftView = await loadForecastExplorerView(admin(), { city: 'RD', rules: 'draft' }, 'en');
      expect(draftView.rules).toBe('draft');
      expect(draftView.split.activeCount).toBe(activeView.split.activeCount + 1);
      expect(draftView.split.draftCount).toBe(activeView.split.draftCount - 1);
      expect(draftView.split.previewRuleCode).not.toBeNull();
    });

    it("approving a rule leaves the run's split and rule set on the Explorer alone; only the draft preview moves", async () => {
      const before = await loadForecastExplorerView(admin(), { city: 'RD' }, 'en');
      await submitRuleVersion(admin(), 'RULE-008', 1);
      await approveRuleVersion(ctxOf('dispatch_supervisor'), 'RULE-008', 1);
      const after = await loadForecastExplorerView(admin(), { city: 'RD' }, 'en');
      expect(after.split.fieldExpected).toBe(before.split.fieldExpected);
      expect(after.split.remoteExpected).toBe(before.split.remoteExpected);
      expect(after.split.ruleSetVersion).toBe(before.split.ruleSetVersion);
      expect(after.split.ruleSetVersion.startsWith('preview-')).toBe(false);
    });

    it('a role with no Classification Rules access never previews a draft, and the split still shows the active numbers', async () => {
      const view = await loadForecastExplorerView(ctxOf('dispatcher', [RD_C]), {}, 'en');
      expect(view.split.canPreviewDraft).toBe(false);
      expect(view.split.activeCount).toBe(0);
      expect(view.split.draftCount).toBe(0);
      expect(view.split.fieldExpected).toBeGreaterThan(0); // the split bar itself is not gated, only the preview
      expect(view.split.ruleSetVersion).not.toBe('');
      expect(view.canOpenClassificationRules).toBe(false);
      // Asking for the draft anyway (hand-edited URL) is
      // refused quietly, not by throwing.
      const asked = await loadForecastExplorerView(ctxOf('dispatcher', [RD_C]), { rules: 'draft' }, 'en');
      expect(asked.rules).toBe('active');
    });
  });
});

describe('localName', () => {
  it('uses the Arabic name when there is one, else English marked as a fallback', () => {
    expect(localName({ name_en: 'Riyadh', name_ar: 'الرياض' }, 'ar')).toEqual({ name: 'الرياض', fallback: false });
    expect(localName({ name_en: 'Riyadh', name_ar: null }, 'ar')).toEqual({ name: 'Riyadh', fallback: true });
    expect(localName({ name_en: 'Riyadh', name_ar: 'الرياض' }, 'en')).toEqual({ name: 'Riyadh', fallback: false });
  });
});
