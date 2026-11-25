// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { buildContext, fixtureTenantId, fixtureUsers } from '@/lib/data/go-test-reset';
import { getLeaveOutlook } from '@/lib/data/leave';
import type { RequestContext } from '@/lib/data/guard';
import { loadLeaveOutlookView, signedPercent } from './outlook';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: outlook.live.test.ts is skipped, not faked.');

/** RD-N, as view.live.test.ts. */
const RD_N = 'eecf5c7f-237c-443c-b331-b75ba3fb26fc';

function ctxOf(role: Role, zoneIds: string[] = []): RequestContext {
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), fixtureTenantId());
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

describe('signedPercent', () => {
  it('writes a share as a signed whole percent with a true minus', () => {
    expect(signedPercent(0.114, 'en')).toBe('+11%');
    expect(signedPercent(-0.07, 'ar')).toBe('−7%');
    expect(signedPercent(0.004, 'en')).toBe('0%');
  });
});

describe.skipIf(!hasApi)('the leave outlook (live, real api and Postgres)', () => {
  it('is Illustrative, 13 weeks from the start of the demo week, every zone of the scope', async () => {
    const raw = await getLeaveOutlook(ctxOf('viewer_auditor'));
    expect(raw.illustrative).toBe(true);
    expect(raw.weeks).toBe(13);
    expect(raw.start_date).toBe('2026-09-13');
    expect(raw.zones.length).toBeGreaterThan(0);
    for (const zone of raw.zones) expect([0, 13]).toContain(zone.weeks.length);
    const scoped = await getLeaveOutlook(ctxOf('planner', [RD_N]));
    expect(scoped.zones.map((z) => z.zone_id)).toEqual([RD_N]);
  });

  it('builds plain data for the card, 13 or 52 weeks a row', async () => {
    for (const weeks of [13, 52] as const) {
      const view = await loadLeaveOutlookView(ctxOf('viewer_auditor'), weeks, 'en');
      expect(['filled', 'empty']).toContain(view.state);
      expect(view.weeks).toBe(weeks);
      for (const row of view.rows) expect(row.cells).toHaveLength(weeks);
      expect(view.flagged.every((c) => c.status !== 'normal')).toBe(true);
      expect(view.headers.reduce((s, h) => s + h.span, 0)).toBe(view.state === 'filled' ? weeks : 0);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    }
  });
});
