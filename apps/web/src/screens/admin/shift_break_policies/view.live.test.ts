// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { loadShiftsView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Shared with other live files: counts are
// floors, exact lists are subsets.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

afterEach(() => {
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');
const SEPTEMBER = new Date('2026-09-13T09:00:00Z');

describe.skipIf(!hasApi)('loadShiftsView (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

  it('counts patterns and break rules, lists the seeded fixture patterns with their hours, and gives the data source', async () => {
    const view = await loadShiftsView(admin(), {}, SEPTEMBER);
    expect(view.counts.active).toBeGreaterThanOrEqual(6);
    expect(view.counts.breaks).toBeGreaterThanOrEqual(2);
    expect(view.sources).toEqual(['SYNTHETIC']);
    expect(view.all.map((p) => p.code)).toEqual(expect.arrayContaining(['DAY-A', 'DAY-B', 'EVENING', 'NIGHT', 'REMOTE-BLOCK-1', 'REMOTE-BLOCK-2']));
    const dayA = view.all.find((p) => p.code === 'DAY-A');
    // tone is positional (view.ts), not a fixed fact.
    expect(dayA).toMatchObject({ name: 'Day A', kind: 'field', normal: { start: '06:00', end: '14:00' }, ramadan: { start: '06:00', end: '12:00' }, status: 'active' });
    expect(dayA?.tone).toBeGreaterThanOrEqual(1);
    expect(view.all.find((p) => p.code === 'EVENING')).toMatchObject({ normal: null, ramadan: { start: '18:00', end: '00:00' } });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it can cross to the client
  });

  it('gives the break rules in minutes and hours, and the Ramadan window, the next Ramadan and whether the day is inside one', async () => {
    const view = await loadShiftsView(admin(), {}, SEPTEMBER);
    expect(view.breaks.map((b) => [b.code, b.minutes, b.afterHours])).toEqual(expect.arrayContaining([['BRK-STD', 30, 5], ['BRK-RAM', 30, 5]]));
    expect(view.today).toBe('2026-09-13');
    expect(view.ramadan).toEqual({ window: { from: '2026-02-18', to: '2026-03-19', hijriYear: 1447 }, next: '2027-02-08', today: false });
    expect((await loadShiftsView(admin(), {}, new Date('2026-03-01T09:00:00Z'))).ramadan).toMatchObject({ today: true, next: '2027-02-08' });
  });

  it('filters by kind, status and search over name and code, keeps the counts and the week\'s patterns whole, and exports what is shown', async () => {
    const c = admin();
    const remote = await loadShiftsView(c, { kind: 'remote' }, SEPTEMBER);
    expect(remote.patterns.map((p) => p.code)).toEqual(['REMOTE-BLOCK-1', 'REMOTE-BLOCK-2']);
    expect(remote.all.length).toBeGreaterThanOrEqual(6);
    expect(remote.counts.active).toBeGreaterThanOrEqual(6);
    const drafts = (await loadShiftsView(c, { status: 'draft' }, SEPTEMBER)).patterns;
    expect(drafts.every((p) => p.status === 'draft')).toBe(true);
    expect((await loadShiftsView(c, { q: 'night' }, SEPTEMBER)).patterns.map((p) => p.code)).toEqual(expect.arrayContaining(['NIGHT']));
    expect(remote.exportHeader).toHaveLength(9);
    expect(remote.exportRows[0]).toEqual(['REMOTE-BLOCK-1', 'Remote block 1', 'remote', '07:00', '15:00', '07:00', '13:00', 'BRK-STD', 'active']);
  });

  it('opens a pattern by id whatever the filters say, says an unknown id is unknown, and `new` is not a pattern', async () => {
    const c = admin();
    const id = (await loadShiftsView(c, {}, SEPTEMBER)).all.find((p) => p.code === 'NIGHT')?.id;
    expect((await loadShiftsView(c, { pattern: id, q: 'zzz' }, SEPTEMBER)).open?.code).toBe('NIGHT');
    expect(await loadShiftsView(c, { pattern: '00000000-0000-4000-8000-00000000dead' }, SEPTEMBER)).toMatchObject({ open: undefined, unknownPattern: true });
    expect(await loadShiftsView(c, { pattern: 'new' }, SEPTEMBER)).toMatchObject({ open: undefined, unknownPattern: false });
  });
});
