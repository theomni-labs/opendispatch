// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { WaitingSpots } from '@/lib/types';
import { spotMarks, waitingSpotsView } from './waiting';

const SPOTS: WaitingSpots = {
  generated_at: '2026-09-13T09:00:00+03:00',
  enabled: true,
  model_version: 'scorer-0.3',
  illustrative: true,
  data_source: 'SYNTHETIC',
  items: [
    { agent_id: 's2', zone_id: 'z1', latitude: 24.73, longitude: 46.72, move_km: 4.66, reason_code: 'cover_expected_demand' },
    { agent_id: 's1', zone_id: 'z2', latitude: 24.61, longitude: 46.7, move_km: 2.04, reason_code: 'rebalance_zone' },
    { agent_id: 'gone', zone_id: 'z1', latitude: 24.7, longitude: 46.7, move_km: 3, reason_code: 'cover_expected_demand' },
  ],
};
const name = (id: string) => `Name ${id}`;
const zone = (id: string) => `RD-${id}`;

describe('waitingSpotsView', () => {
  it('lists every suggestion, shortest drive first, rounded to 0.1 km', () => {
    const view = waitingSpotsView(SPOTS, name, zone);
    expect(view.enabled).toBe(true);
    expect(view.illustrative).toBe(true);
    expect(view.generatedAt).toBe('09:00');
    expect(view.rows.map((r) => [r.agentId, r.moveKm, r.zoneCode, r.reason])).toEqual([
      ['s1', 2, 'RD-z2', 'rebalance_zone'],
      ['gone', 3, 'RD-z1', 'cover_expected_demand'],
      ['s2', 4.7, 'RD-z1', 'cover_expected_demand'],
    ]);
  });

  it('says when the setting is off', () => {
    const view = waitingSpotsView({ ...SPOTS, enabled: false, generated_at: null, items: [] }, name, zone);
    expect(view).toEqual({ enabled: false, illustrative: true, generatedAt: null, rows: [] });
  });
});

describe('spotMarks', () => {
  it('draws a spot and an arrow from where the agent is, and skips one the map does not show', () => {
    const at = new Map([
      ['s1', [24.6, 46.69] as const],
      ['s2', [24.7, 46.7] as const],
    ]);
    const marks = spotMarks(SPOTS.items, (id) => at.get(id), name);
    expect(marks.pins.map((p) => [p.id, p.kind, p.label])).toEqual([
      ['spot:s2', 'spot', 'Name s2'],
      ['spot:s1', 'spot', 'Name s1'],
    ]);
    expect(marks.links).toEqual([
      { from: [24.7, 46.7], to: [24.73, 46.72], kind: 'suggestion' },
      { from: [24.6, 46.69], to: [24.61, 46.7], kind: 'suggestion' },
    ]);
  });
});
