// SPDX-License-Identifier: AGPL-3.0-only
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Case/CaseType is api-backed. Read only here: cases.ts
// never writes (imports.ts's cut-over does).
// Concurrent import live tests may cut over new
// cases (IMPORTED) while this runs: counts
// against the fixture baseline are floors, not
// exact, same pattern as every other api-backed table.

import { describe, expect, it } from 'vitest';
import type { Case, CaseType, DataSource } from '@/lib/types';
import { ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { getCase, listCases, listCaseTypes } from './cases';
import { ctxFor, expectValid, expectValidItems, fixtureZoneIds, withTempDemoState } from './test-support';

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

describe.skipIf(!hasApi)('cases (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: cases.live.test.ts is skipped, not faked.');

  withTempDemoState();

  const admin = () => ctxFor('administrator');
  const zones = () => fixtureZoneIds();
  const SOURCES: readonly DataSource[] = ['SYNTHETIC', 'IMPORTED', 'LIVE'];

  it('serves the fixture cases, newest first, and validates against the contract', async () => {
    const ctx = admin();
    const all = fixtureRecords<Case>('Case');
    const list = await listCases(ctx, { limit: 200 });
    expect(list.page.total).toBeGreaterThanOrEqual(all.length);
    expect(list.items).toHaveLength(200);
    const times = list.items.map((c) => Date.parse(c.registered_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expectValid('CaseList', list);
    expectValid('Case', await getCase(ctx, all[0]!.id));
  });

  it('every case carries a valid data source and a handling of field or remote_inferred', async () => {
    const cases = (await listCases(admin(), { limit: 200 })).items;
    for (const c of cases) {
      expect(SOURCES).toContain(c.data_source);
      expect(['field', 'remote_inferred']).toContain(c.handling);
    }
  });

  it('filters by zone, date, handling, type, source and free text', async () => {
    const ctx = admin();
    const oneDay = await listCases(ctx, { date_from: '2026-09-08', date_to: '2026-09-08', limit: 200 });
    expect(oneDay.page.total).toBe(fixtureRecords<Case>('Case').filter((c) => c.registered_at.startsWith('2026-09-08')).length);
    expect(oneDay.items.every((c) => c.registered_at.startsWith('2026-09-08'))).toBe(true);
    const zone = await listCases(ctx, { zone_id: zones()[0] as string, date_from: '2026-09-06', date_to: '2026-09-06', limit: 200 });
    expect(zone.items.every((c) => c.zone_id === zones()[0])).toBe(true);
    expect((await listCases(ctx, { handling: 'remote_inferred', limit: 200 })).items.every((c) => c.handling === 'remote_inferred')).toBe(true);
    const type = (await listCaseTypes(ctx)).items.find((t) => t.name_en === 'Unlisted')!;
    expect((await listCases(ctx, { case_type_id: type.id, limit: 200 })).items.every((c) => c.case_type_id === type.id)).toBe(true);
    // A concurrent import test's cut-over may already have added IMPORTED cases: check the filter is correct, not that none exist.
    expect((await listCases(ctx, { data_source: 'IMPORTED' })).items.every((c) => c.data_source === 'IMPORTED')).toBe(true);
    const known = fixtureRecords<Case>('Case')[5]!;
    expect((await listCases(ctx, { q: known.case_number })).items.map((c) => c.id)).toEqual([known.id]);
    expect((await listCases(ctx, { city_id: known.city_id, sub_zone_id: known.sub_zone_id, limit: 200 })).items.every((c) => c.sub_zone_id === known.sub_zone_id)).toBe(true);
  });

  it('reads many cases by id in one call, the same as one getCase each', async () => {
    const ctx = admin();
    const picked = fixtureRecords<Case>('Case').filter((_, i) => i % 97 === 0).slice(0, 40);
    const ids = picked.map((c) => c.id);
    const batch = await listCases(ctx, { ids, limit: 200 });
    expectValid('CaseList', batch);
    const one = await Promise.all(ids.map((id) => getCase(ctx, id)));
    expect(new Map(batch.items.map((c) => [c.id, c] as const))).toEqual(new Map(one.map((c) => [c.id, c] as const)));
    expect((await listCases(ctx, { ids: [...ids, '00000000-0000-4000-8000-000000000000'], limit: 200 })).items).toHaveLength(ids.length);
    expect((await listCases(ctx, { ids, handling: 'field', limit: 200 })).items.every((c) => c.handling === 'field')).toBe(true);
    expect(await listCases(ctx, { ids: [] })).toEqual({ items: [], page: { next_cursor: null, has_more: false, total: 0 } });
    await expect(listCases(ctx, { ids: ['not-a-uuid'] })).rejects.toThrow(InvalidInputError);
    await expect(listCases(ctx, { ids: Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) })).rejects.toThrow(InvalidInputError);
    const scoped = ctxFor('dispatcher', { zones: [zones()[0] as string] });
    const mine = (await listCases(scoped, { ids, limit: 200 })).items;
    expect(mine.every((c) => c.zone_id === zones()[0])).toBe(true);
    expect(mine.map((c) => c.id).sort()).toEqual(picked.filter((c) => c.zone_id === zones()[0]).map((c) => c.id).sort());
  });

  it('shows a dispatcher only the cases of their own zones', async () => {
    const ctx = ctxFor('dispatcher', { zones: [zones()[0] as string, zones()[1] as string] });
    const list = await listCases(ctx, { limit: 200 });
    expect(new Set(list.items.map((c) => c.zone_id))).toEqual(new Set([zones()[0], zones()[1]]));
    const outside = fixtureRecords<Case>('Case').find((c) => c.zone_id === zones()[7])!;
    await expect(getCase(ctx, outside.id)).rejects.toThrow(NotFoundError);
    expect(list.page.total).toBeLessThan((await listCases(admin())).page.total ?? 0);
    expect((await listCases(ctxFor('planner', { zones: [] }))).items).toHaveLength(0);
  });

  it('is closed to the Change Approver, open to the other roles, and lists the three case types', async () => {
    await expect(listCases(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
    for (const role of ['viewer_auditor', 'remote_team_lead', 'dispatch_supervisor', 'planner'] as const) await expect(listCases(ctxFor(role))).resolves.toBeDefined();
    const types = await listCaseTypes(admin());
    expectValid('CaseTypeList', types);
    expect(types.items).toHaveLength(fixtureRecords<CaseType>('CaseType').length);
    expectValidItems('CaseType', types.items);
    expect(types.items.map((t) => t.name_en).sort()).toEqual(['Standard case', 'Police attended', 'Unlisted']);
  });
});
