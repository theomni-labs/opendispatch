// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@/lib/data/guard';
import { classificationOf, clockOf, loadLiveDispatchView } from './view';

// Reads run at once; the view must not care.
const env = vi.hoisted(() => ({ hidden: [] as string[], delays: false, recoInFlight: 0, peak: 0, recoCalls: [] as string[], unmetQueries: [] as Record<string, unknown>[] }));

async function answer<T>(value: T): Promise<T> {
  if (env.delays) await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 6)));
  return value;
}

const ZONES = ['z1', 'z2'].map((id, i) => ({ id, name_en: `Zone ${i}`, latitude: 24.7, longitude: 46.7, extra: { code: `RD-${i}` } }));
const AGENTS = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name_en: `Agent ${i}` }));
const STATUSES = AGENTS.slice(0, 9).map((s, i) => ({ agent_id: s.id, status: ['available', 'en_route', 'on_scene'][i % 3], latitude: 24.7, longitude: 46.7 }));
const STATES = ['recommended', 'waiting', 'assigned', 'recommended', 'overridden', 'fallback_assigned', 'recommended'] as const;
const CASES = Array.from({ length: 40 }, (_, i) => {
  const state = STATES[i % STATES.length]!;
  const reco = { agent_id: `s${i % 12}`, estimated_travel_seconds: 300 + i, estimated_arrival_at: '2026-09-13T08:20:00+03:00' };
  const decided = state === 'assigned' || state === 'overridden' || state === 'fallback_assigned';
  return {
    case_id: `c${String(i).padStart(2, '0')}`,
    case_number: `RD-${i}`,
    zone_id: ZONES[i % 2]!.id,
    registered_at: `2026-09-13T0${7 + (i % 2)}:${String(i).padStart(2, '0')}:00+03:00`,
    latitude: 24.7,
    longitude: 46.7,
    parties_involved: 1 + (i % 3),
    state,
    stage: 'recommend',
    data_source: 'SYNTHETIC',
    recommendation: i % 5 === 4 ? null : reco,
    assigned_agent_id: decided ? `s${(i + 1) % 12}` : null,
    assignment_source: state === 'overridden' ? 'MANUAL' : decided ? 'OPENDISPATCH' : null,
    estimated_arrival_at: decided ? '2026-09-13T08:30:00+03:00' : null,
  };
});
const ranking = (caseId: string) => {
  const n = Number(caseId.slice(1));
  return Array.from({ length: 9 }, (_, k) => ({ agent_id: `s${(n + k) % 12}`, estimated_travel_seconds: 60 * (k + 1) + n }));
};
const BOARD = {
  replay: { status: 'playing', replay_date: '2026-09-12', replay_at: '2026-10-02T09:00:00+03:00', delivered_cases: 40, total_cases: 40, feed_outage_active: false },
  fallback: { state: 'armed', reason: 'none', since: null, timeout_seconds: 5, fallback_assigned_count: 5 },
  stages: ZONES.map((z) => ({ zone_id: z.id, stage: 'recommend' })),
  cases: CASES,
  data_source: 'SYNTHETIC',
};
const COMPARISONS = CASES.slice(0, 8).map((c, i) => ({
  id: `cmp${i}`,
  case_id: c.case_id,
  zone_id: c.zone_id,
  compared_at: '2026-09-13T00:10:00+03:00',
  same_agent: i % 2 === 0,
  opendispatch: { agent_id: `s${i}`, estimated_travel_seconds: 400 },
  customer: { agent_id: i % 3 === 0 ? null : `s${i + 1}`, actual_travel_seconds: 500 },
}));
const page = <T>(items: T[]) => ({ items, page: { has_more: false, next_cursor: null } });
const UNMET = [
  { case_id: 'c24', case_number: 'RD-24', zone_id: 'z1', registered_at: '2026-09-13T07:24:00+03:00', cause: 'people', nearest_agent_id: null, nearest_travel_seconds: null, threshold_seconds: 720, state: 'waiting', data_source: 'SYNTHETIC' },
  { case_id: 'c03', case_number: 'RD-3', zone_id: 'z2', registered_at: '2026-09-13T08:03:00+03:00', cause: 'geography', nearest_agent_id: 's3', nearest_travel_seconds: 840, threshold_seconds: 720, state: 'recommended', data_source: 'SYNTHETIC' },
];

vi.mock('@/lib/data/dispatch', () => ({
  getLiveBoard: () => answer(BOARD),
  listAgentStatuses: () => answer(page(STATUSES)),
  getCaseRecommendation: (_ctx: unknown, caseId: string) => {
    env.recoCalls.push(caseId);
    env.recoInFlight += 1;
    env.peak = Math.max(env.peak, env.recoInFlight);
    return answer({ status: Number(caseId.slice(1)) % 6 === 0 ? 'no_eligible_agent' : 'ranked', ranking: ranking(caseId) }).finally(() => {
      env.recoInFlight -= 1;
    });
  },
  getShadowComparisonSummary: () =>
    answer({
      illustrative: true,
      customer: { from_assignment: { share: 0.5 }, from_registration: { share: 0.4 } },
      opendispatch: { from_assignment: { share: 0.6 }, from_registration: { share: 0.55 } },
      cases_compared: 8,
      from: '2026-09-12T00:00:00+03:00',
      to: '2026-09-13T00:00:00+03:00',
    }),
  listShadowComparisons: () => answer(page(COMPARISONS)),
  listUnmetDemand: (_ctx: unknown, q: { date?: string; zone_id?: string; cause?: string }) => {
    env.unmetQueries.push({ ...q });
    const date = q.date ?? '2026-09-12';
    const items = date !== '2026-09-12' ? [] : UNMET.filter((r) => (q.zone_id === undefined || r.zone_id === q.zone_id) && (q.cause === undefined || r.cause === q.cause));
    return answer({ date, threshold_seconds: 720, illustrative: true, items, page: { has_more: false, next_cursor: null }, data_source: 'SYNTHETIC' });
  },
  listWaitingSpots: () =>
    answer({
      generated_at: '2026-10-02T09:00:00+03:00',
      enabled: true,
      model_version: 'scorer-0.3',
      illustrative: true,
      data_source: 'SYNTHETIC',
      items: [
        { agent_id: 's0', zone_id: 'z1', latitude: 24.73, longitude: 46.72, move_km: 3.2, reason_code: 'cover_expected_demand' },
        { agent_id: 's11', zone_id: 'z2', latitude: 24.6, longitude: 46.7, move_km: 2.1, reason_code: 'cover_expected_demand' },
      ],
    }),
}));
vi.mock('@/lib/data/locations', () => ({ listZones: () => answer(page(ZONES)) }));
vi.mock('@/lib/data/people', () => ({ listAgents: () => answer(page(AGENTS.filter((s) => !env.hidden.includes(s.id)))) }));
vi.mock('@/lib/data/settings', () => ({ getSettingsSnapshot: () => answer({ clock_start: 'assignment', ten_minute_threshold_seconds: 720 }) }));
vi.mock('@/lib/data/cases', () => ({
  listCases: (_ctx: unknown, q: { ids: string[] }) => answer(page(CASES.filter((c) => q.ids.includes(c.case_id)).map((c) => ({ id: c.case_id, case_number: c.case_number })))),
}));

const ctx = {} as RequestContext;

beforeEach(() => {
  env.hidden = [];
  env.delays = false;
  env.peak = 0;
  env.recoCalls = [];
  env.unmetQueries = [];
});

describe('loadLiveDispatchView: reads at once, same view', () => {
  it('gives the same view whatever order the reads answer in', async () => {
    const inOrder = await loadLiveDispatchView(ctx, 'en');
    env.delays = true;
    for (let run = 0; run < 5; run++) expect(await loadLiveDispatchView(ctx, 'en')).toEqual(inOrder);
  });

  it('lists waiting spots and draws an arrow only for agents on the map', async () => {
    const view = await loadLiveDispatchView(ctx, 'en');
    expect(view.waiting.rows.map((r) => [r.name, r.zoneCode, r.moveKm])).toEqual([
      ['Agent 11', 'RD-1', 2.1],
      ['Agent 0', 'RD-0', 3.2],
    ]);
    expect(view.map.spots).toBe(true);
    expect(view.map.pins.filter((p) => p.kind === 'spot').map((p) => p.id)).toEqual(['spot:s0']);
    expect(view.map.links.filter((l) => l.kind === 'suggestion')).toEqual([{ from: [24.7, 46.7], to: [24.73, 46.72], kind: 'suggestion' }]);
  });

  it('dates the replay by its own day, not the clock', async () => {
    const view = await loadLiveDispatchView(ctx, 'en');
    expect(view.replay.dateBoth).toMatch(/^12 Sept? 2026 · /);
    expect(view.replay.time).toBe('09:00');
  });

  it('keeps board order in each column and gives each card its own options', async () => {
    env.delays = true;
    const view = await loadLiveDispatchView(ctx, 'en');
    const order = CASES.map((c) => c.case_id);
    for (const cards of Object.values(view.columns)) {
      const ids = cards.map((c) => c.caseId);
      expect(ids).toEqual([...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    }
    const recommended = CASES.filter((c) => c.state === 'recommended');
    expect(view.columns.recommended.map((c) => c.caseId)).toEqual(recommended.map((c) => c.case_id));
    expect([...env.recoCalls].sort()).toEqual(recommended.map((c) => c.case_id).sort());
    for (const card of view.columns.recommended) {
      const c = CASES.find((x) => x.case_id === card.caseId)!;
      const want =
        Number(c.case_id.slice(1)) % 6 === 0
          ? []
          : ranking(c.case_id)
              .filter((r) => r.agent_id !== c.recommendation?.agent_id)
              .slice(0, 6)
              .map((r) => ({ agentId: r.agent_id, name: `Agent ${r.agent_id.slice(1)}`, minutes: Math.round(r.estimated_travel_seconds / 60) }));
      expect(card.overrideOptions).toEqual(want);
    }
    for (const col of ['waiting', 'assigned', 'enroute', 'onscene'] as const) {
      for (const card of view.columns[col]) expect(card.overrideOptions).toBeUndefined();
    }
    expect(view.comparisons.map((r) => r.caseNumber)).toEqual(COMPARISONS.map((r) => CASES.find((c) => c.case_id === r.case_id)!.case_number));
  });

  it('logs the api\'s cases out of reach, with the threshold from the settings', async () => {
    const view = await loadLiveDispatchView(ctx, 'en');
    expect(view.unmet.rows).toEqual([
      { caseId: 'c24', caseNumber: 'RD-24', zoneId: 'z1', zoneCode: 'RD-0', time: '07:24', nearestName: null, travelMinutes: null, cause: 'people' },
      { caseId: 'c03', caseNumber: 'RD-3', zoneId: 'z2', zoneCode: 'RD-1', time: '08:03', nearestName: 'Agent 3', travelMinutes: 14, cause: 'geography' },
    ]);
    expect(view.unmet.thresholdMinutes).toBe(12);
    expect(view.unmet.dayOptions[0]).toBe('2026-09-12');
    expect(view.unmet.zoneOptions.map((o) => o.value)).toEqual(['z1', 'z2']);
    expect(view.columns.recommended.find((c) => c.caseId === 'c03')?.overReach).toBe(true);
    expect(Object.values(view.columns).flat().filter((c) => c.overReach === true).map((c) => c.caseId)).toEqual(['c03']);
    expect(env.unmetQueries).toEqual([{ limit: 200, cursor: undefined, date: undefined, zone_id: undefined, cause: undefined }]);
  });

  it('asks the api for the chosen zone, day and cause', async () => {
    const geo = await loadLiveDispatchView(ctx, 'en', { cause: 'geography', zone: 'z2' });
    expect(geo.unmet.rows.map((r) => r.caseId)).toEqual(['c03']);
    expect(env.unmetQueries).toContainEqual({ limit: 200, cursor: undefined, date: undefined, zone_id: 'z2', cause: 'geography' });
    const other = await loadLiveDispatchView(ctx, 'en', { day: '2026-09-11' });
    expect(other.unmet.rows).toEqual([]);
    expect(other.unmet.day).toBe('2026-09-11');
    expect(other.columns.recommended.find((c) => c.caseId === 'c03')?.overReach).toBe(true);
  });

  it('asks for at most eight recommendations at once', async () => {
    env.delays = true;
    await loadLiveDispatchView(ctx, 'en');
    expect(env.peak).toBeGreaterThan(1);
    expect(env.peak).toBeLessThanOrEqual(8);
  });
});

describe('the recommended agent on a card', () => {
  const ctx = { customerId: 't', userId: 'u', role: 'dispatcher', zoneScope: { kind: 'whole_install' }, installMode: 'private' } as unknown as RequestContext;

  it('names the OpenDispatch pick with its ETA, and the assigned agent of a decided card', async () => {
    const view = await loadLiveDispatchView(ctx, 'en');
    for (const card of view.columns.recommended) {
      const c = CASES.find((x) => x.case_id === card.caseId)!;
      if (c.recommendation === null) continue;
      expect(card.pick).toEqual({ name: `Agent ${c.recommendation.agent_id.slice(1)}`, label: 'opendispatch_pick' });
      expect(card.eta).toEqual({ kind: 'eta', time: '08:20' });
    }
    for (const card of [...view.columns.assigned, ...view.columns.enroute, ...view.columns.onscene]) expect(card.pick?.name).toMatch(/^Agent \d+$/);
  });

  it('gives no name, never a dash, when the pick is outside the reader\'s zones', async () => {
    env.hidden = AGENTS.map((s) => s.id);
    const view = await loadLiveDispatchView(ctx, 'en');
    const picks = view.columns.recommended.flatMap((c) => (c.pick === undefined ? [] : [c.pick]));
    expect(picks.length).toBeGreaterThan(0);
    for (const pick of picks) expect(pick.name).toBeNull();
  });

  it('dates an ETA that falls on another day than the registration', () => {
    expect(clockOf('2026-09-13T10:46:00+03:00', '2026-09-13T10:42:00+03:00', 'en')).toBe('10:46');
    expect(clockOf('2026-09-14T08:14:00+03:00', '2026-09-13T19:29:00+03:00', 'en')).toMatch(/^14 Sept? 2026 08:14$/);
  });
});

// the card's line from LiveCase.classification.
describe('classificationOf', () => {
  const cls = {
    outcome: 'remote_eligible', handling: 'remote_inferred', source: 'rules', rule_code: 'RULE-010', rule_version: 1, rule_name_en: 'Minor: remote',
    rule_name_ar: 'بسيطة: عن بعد', rule_set_version: 'rules-x', feed_handling: null, classified_at: '2026-09-13T08:00:00+03:00',
  } as const;
  it('names the rule in the page language, or none for the default', () => {
    expect(classificationOf({ classification: cls }, 'en')).toEqual({ handling: 'remote', rule: 'Minor: remote', source: 'rules' });
    expect(classificationOf({ classification: cls }, 'ar')?.rule).toBe('بسيطة: عن بعد');
    expect(classificationOf({ classification: { ...cls, rule_name_ar: null } }, 'ar')?.rule).toBe('Minor: remote');
    expect(classificationOf({ classification: { ...cls, handling: 'field', rule_code: null, rule_name_en: null, rule_name_ar: null } }, 'en')).toEqual({ handling: 'field', rule: null, source: 'rules' });
    expect(classificationOf({}, 'en')).toBeUndefined();
  });
});
