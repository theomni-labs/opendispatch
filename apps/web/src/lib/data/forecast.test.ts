// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { ForecasterEngineOutput, ForecastValue } from '@/lib/types';
import { ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import {
  getForecastRun,
  getForecastSplit,
  getForecastTimeline,
  listForecastRuns,
  listForecastValues,
} from './forecast';
import { fixtureObject } from './internal/fixtures';
import { approveRuleVersion, listRuleVersions, retireRule, submitRuleVersion } from './rules';
import { ctxFor, expectJunkIdsInvalidLive, expectValid, fixtureZoneIds, JUNK_IDS, withTempDemoState } from './test-support';

withTempDemoState();

const admin = () => ctxFor('administrator');
const [riyadhCentral, riyadhNorth, riyadhEast, , , jeddahNorth] = fixtureZoneIds();
const monday = '2026-09-14';

async function allValues(zoneId: string, date: string): Promise<ForecastValue[]> {
  const rows: ForecastValue[] = [];
  let cursor: string | undefined;
  do {
    const page = await listForecastValues(admin(), { zone_id: zoneId, date, limit: 200, cursor });
    rows.push(...page.items);
    cursor = page.page.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return rows;
}

describe('forecast runs', () => {
  it('lists the committed run and validates against the contract', async () => {
    const list = await listForecastRuns(admin());
    // auto-retrain may add a run in the background
    const run = list.items.find((r) => r.horizon_start_date === monday && r.model_version === 'placeholder-0.1');
    expect(run).toMatchObject({ status: 'succeeded', illustrative: true, horizon_start_date: monday });
    expectValid('ForecastRunList', list);
    expect(await getForecastRun(admin(), run?.id ?? '')).toEqual(run);
    expect((await listForecastRuns(admin(), { status: 'failed' })).items).toHaveLength(0);
    await expect(listForecastRuns(admin(), { status: 'bogus' as 'failed' })).rejects.toThrow(InvalidInputError);
    await expect(getForecastRun(admin(), 'f0f0f0f0-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
  });
});

describe('values per zone, sub-zone and interval', () => {
  it('returns 96 intervals for every sub-zone, with low <= expected <= high and a consistent split', async () => {
    const rows = await allValues(riyadhCentral ?? '', monday);
    expect(rows).toHaveLength(16 * 96);
    for (const row of rows) {
      expect(row.low).toBeLessThanOrEqual(row.expected);
      expect(row.expected).toBeLessThanOrEqual(row.high);
      expect(Math.abs(row.field_expected + row.remote_inferred_expected - row.expected)).toBeLessThanOrEqual(0.01);
    }
    expectValid('ForecastValueList', await listForecastValues(admin(), { zone_id: riyadhCentral, date: monday, limit: 50 }));
  });

  it('filters by sub-zone and by interval start (the heat overlay)', async () => {
    const rows = await allValues(riyadhCentral ?? '', monday);
    const sub = rows[0]?.sub_zone_id ?? '';
    expect((await listForecastValues(admin(), { zone_id: riyadhCentral, sub_zone_id: sub, date: monday, limit: 200 })).items).toHaveLength(96);
    const heat = await listForecastValues(admin(), { zone_id: riyadhCentral, date: monday, interval_start: '2026-09-14T09:00:00+03:00', limit: 200 });
    expect(heat.items).toHaveLength(16);
    expect(new Set(heat.items.map((r) => r.interval_index))).toEqual(new Set([36]));
  });

  it('takes the split from the stored row, not from the rules', async () => {
    const stored = await allValues(riyadhCentral ?? '', monday);
    const before = stored.reduce((sum, r) => sum + r.field_expected, 0);
    await submitRuleVersion(admin(), 'RULE-008', 1);
    await approveRuleVersion(ctxFor('dispatch_supervisor'), 'RULE-008', 1);
    const after = (await allValues(riyadhCentral ?? '', monday)).reduce((sum, r) => sum + r.field_expected, 0);
    expect(after).toBe(before);
  });

  it('derives another date from the reference day and the weekday profile of the case history', async () => {
    const tuesday = await allValues(riyadhCentral ?? '', '2026-09-15');
    expect(tuesday).toHaveLength(16 * 96);
    expect(tuesday[0]?.interval_start.startsWith('2026-09-15')).toBe(true);
    const sum = (rows: ForecastValue[]) => rows.reduce((s, r) => s + r.expected, 0);
    const ratio = sum(tuesday) / sum(await allValues(riyadhCentral ?? '', monday));
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
    expect(ratio).not.toBe(1);
    expectValid('ForecastValueList', await listForecastValues(admin(), { zone_id: riyadhCentral, date: '2026-09-15', limit: 10 }));
  });
});

describe('timeline of one zone and day', () => {
  it('sums the sub-zones into at most 96 intervals with the likely range and the split', async () => {
    const timeline = await getForecastTimeline(admin(), { zone_id: riyadhCentral, date: monday });
    expect(timeline.intervals).toHaveLength(96);
    expect(timeline.illustrative).toBe(true);
    expect(timeline.data_source).toBe('SYNTHETIC');
    for (const i of timeline.intervals) {
      expect(i.low).toBeLessThanOrEqual(i.expected);
      expect(i.expected).toBeLessThanOrEqual(i.high);
      expect(Math.abs(i.field_expected + i.remote_inferred_expected - i.expected)).toBeLessThanOrEqual(0.01);
    }
    expectValid('ForecastTimeline', timeline);
    const total = timeline.intervals.reduce((s, i) => s + i.expected, 0);
    const summed = (await allValues(riyadhCentral ?? '', monday)).reduce((s, r) => s + r.expected, 0);
    expect(total).toBeCloseTo(summed, 1);
  });

  it('needs a zone and a valid date', async () => {
    await expect(getForecastTimeline(admin(), { date: monday })).rejects.toThrow(InvalidInputError);
    await expect(getForecastTimeline(admin(), { zone_id: riyadhCentral, date: '14/09/2026' })).rejects.toThrow(InvalidInputError);
    await expect(getForecastTimeline(admin(), { zone_id: 'f0f0f0f0-0000-4000-8000-000000000000', date: monday })).rejects.toThrow(NotFoundError);
  });
});

describe("flow 1: a run's split is its own, rules only preview", () => {
  it('splits every zone and validates against the contract', async () => {
    const split = await getForecastSplit(admin());
    expect(split.zones).toHaveLength(8);
    expect(split.illustrative).toBe(true);
    for (const zone of split.zones) {
      expect(zone.field_share).toBeGreaterThan(0);
      expect(zone.field_share).toBeLessThan(1);
    }
    expectValid('ForecastSplit', split);
  });

  it('agrees with the timeline of a zone', async () => {
    const split = await getForecastSplit(admin(), { zone_id: riyadhNorth, date: monday });
    const timeline = await getForecastTimeline(admin(), { zone_id: riyadhNorth, date: monday });
    expect(split.zones).toHaveLength(1);
    const field = timeline.intervals.reduce((s, i) => s + i.field_expected, 0);
    expect(split.zones[0]?.field_expected).toBeCloseTo(field, 1);
  });

  it("leaves a stored run's split and its rule set alone when rules are approved or retired", async () => {
    const before = await getForecastSplit(admin());
    await submitRuleVersion(admin(), 'RULE-008', 1);
    await approveRuleVersion(ctxFor('dispatch_supervisor'), 'RULE-008', 1, { note: 'Unlisted cases always go to the field.' });
    await retireRule(admin(), 'RULE-005');
    const after = await getForecastSplit(admin());
    expect(after.rule_set_version).toBe(before.rule_set_version);
    expect(after.rule_set_version.startsWith('preview-')).toBe(false);
    expect(after.zones).toEqual(before.zones);
    const run = (await listForecastRuns(admin())).items[0];
    expect(before.rule_set_version).toBe(run?.rule_set_version);
  });

  it('previews a submitted version as a labelled preview without touching the run', async () => {
    await submitRuleVersion(admin(), 'RULE-008', 1);
    const active = await getForecastSplit(admin());
    const draftVersion = await getRuleVersionId('RULE-008');
    const preview = await getForecastSplit(admin(), { rule_version_id: draftVersion });
    expect(preview.rule_set_version.startsWith('preview-')).toBe(true);
    for (const zone of preview.zones) {
      const was = active.zones.find((z) => z.zone_id === zone.zone_id);
      expect(zone.field_expected + zone.remote_inferred_expected).toBeCloseTo((was?.field_expected ?? 0) + (was?.remote_inferred_expected ?? 0), 1);
    }
    expect((await getForecastSplit(admin())).zones).toEqual(active.zones);
  });

  it('keeps the same split across a fresh module instance', async () => {
    const before = await getForecastSplit(admin());
    await submitRuleVersion(admin(), 'RULE-008', 1);
    await approveRuleVersion(ctxFor('dispatch_supervisor'), 'RULE-008', 1);
    vi.resetModules();
    const fresh = await import('./forecast');
    expect((await fresh.getForecastSplit(admin())).zones).toEqual(before.zones);
  });
});

describe('who may read and which zones', () => {
  it('lets every Ops role but the Change Approver read', async () => {
    for (const role of ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor'] as const) {
      await expect(listForecastRuns(ctxFor(role))).resolves.toBeDefined();
    }
    const changeApprover = ctxFor('change_approver');
    await expect(listForecastRuns(changeApprover)).rejects.toThrow(ForbiddenError);
    await expect(getForecastSplit(changeApprover)).rejects.toThrow(ForbiddenError);
    await expect(getForecastTimeline(changeApprover, { zone_id: riyadhCentral, date: monday })).rejects.toThrow(ForbiddenError);
    await expect(listForecastValues(changeApprover)).rejects.toThrow(ForbiddenError);
  });

  it('keeps an assigned-zone role to its zones and lets the remote pool read across zones', async () => {
    const planner = ctxFor('planner');
    expect((await getForecastSplit(planner)).zones.map((z) => z.zone_id).sort()).toEqual([riyadhCentral, riyadhNorth, riyadhEast].sort());
    await expect(getForecastTimeline(planner, { zone_id: jeddahNorth, date: monday })).rejects.toThrow(NotFoundError);
    expect((await listForecastValues(planner, { zone_id: jeddahNorth, date: monday })).items).toHaveLength(0);
    const lead = ctxFor('remote_team_lead');
    expect((await getForecastSplit(lead)).zones).toHaveLength(8);
    expect((await getForecastTimeline(lead, { zone_id: jeddahNorth, date: monday })).intervals).toHaveLength(96);
    expect((await getForecastSplit(ctxFor('dispatcher'))).zones).toHaveLength(2);
  });
});

// The version id of the (draft or submitted) first version of a rule.
async function getRuleVersionId(ruleCode: string): Promise<string> {
  const row = (await listRuleVersions(admin(), ruleCode, { limit: 200 })).items.find((r) => r.version === 1);
  return row?.id ?? '';
}

// ---------------------------------------------------------------------------------------------
// The forecaster output (review M3): fixtures/engines/forecaster.output.json is served
// ---------------------------------------------------------------------------------------------

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

describe('the forecaster output is served (review M3)', () => {
  it('gives the timeline of the zone and day it covers the values of the output, sub-zones summed', async () => {
    const doc = fixtureObject<ForecasterEngineOutput>('forecaster.output');
    expect(doc?.values).toHaveLength(1536);
    const timeline = await getForecastTimeline(admin(), { zone_id: riyadhCentral, date: monday });
    expect(timeline.intervals).toHaveLength(96);
    for (const interval of timeline.intervals) {
      const rows = (doc?.values ?? []).filter((row) => row.interval_index === interval.interval_index);
      expect(rows).toHaveLength(16);
      expect(interval.expected).toBe(r3(rows.reduce((s, row) => s + row.expected, 0)));
      expect(interval.low).toBe(r3(rows.reduce((s, row) => s + row.low, 0)));
      expect(interval.high).toBe(r3(rows.reduce((s, row) => s + row.high, 0)));
    }
    expectValid('ForecastTimeline', timeline);
  });

  it('keeps the zone scope: a role with the zone reads the same values, a role without it reads nothing', async () => {
    expect(await getForecastTimeline(ctxFor('planner'), { zone_id: riyadhCentral, date: monday })).toEqual(await getForecastTimeline(admin(), { zone_id: riyadhCentral, date: monday }));
    await expect(getForecastTimeline(ctxFor('planner'), { zone_id: jeddahNorth, date: monday })).rejects.toThrow(NotFoundError);
  });
});

describe('crafted ids (review M4)', () => {
  it('refuses a crafted run id or zone id up front and changes nothing', async () => {
    await expectJunkIdsInvalidLive(async (id) => await getForecastRun(admin(), id));
    await expectJunkIdsInvalidLive(async (id) => await getForecastTimeline(admin(), { zone_id: id, date: monday }));
    // `undefined` means "the latest run" for run_id, so only the other junk is checked
    await expectJunkIdsInvalidLive(async (id) => (id === undefined ? await getForecastTimeline(admin(), { date: monday }) : await getForecastTimeline(admin(), { zone_id: riyadhCentral, date: monday, run_id: id as string })));
    expect(JUNK_IDS.length).toBeGreaterThan(10);
  });

  it('answers forbidden before it looks at the id', async () => {
    const changeApprover = ctxFor('change_approver');
    for (const id of JUNK_IDS) {
      await expect(getForecastRun(changeApprover, id as never)).rejects.toThrow(ForbiddenError);
      await expect(getForecastTimeline(changeApprover, { zone_id: id as never, date: monday })).rejects.toThrow(ForbiddenError);
    }
  });
});
