// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { changeParts, changeText, patternLabel, remoteDeltas, remoteReading, remoteTotal, signed, unsupportedParts } from './changes';

const none = { field: 0, remote: 0, veh: 0, patternCodes: [], sharePercent: null };

describe('changeParts', () => {
  it('is empty when nothing changes', () => {
    expect(changeParts(none)).toEqual([]);
  });
  it('lists each change in the mockup order', () => {
    expect(changeParts({ field: 4, remote: -1, veh: 2, patternCodes: ['DAY-A', 'EVENING'], sharePercent: 35 })).toEqual([
      { kind: 'field', n: 4 },
      { kind: 'remote', n: -1 },
      { kind: 'veh', n: 2 },
      { kind: 'pats', codes: ['DAY-A', 'EVENING'] },
      { kind: 'share', p: 35 },
    ]);
  });
  it('keeps a share of zero, which is a change', () => {
    expect(changeParts({ ...none, sharePercent: 0 })).toEqual([{ kind: 'share', p: 0 }]);
  });
});

describe('unsupportedParts', () => {
  it('names the remote change only: the optimizer applies vehicles', () => {
    expect(unsupportedParts({ remote: 0 })).toEqual([]);
    expect(unsupportedParts({ remote: 3 })).toEqual([{ kind: 'remote', n: 3 }]);
  });
});

describe('remote readings', () => {
  const zones = ['a', 'b', 'c'];
  it('reads one change on the first zone as company-wide', () => {
    expect(remoteReading(zones, [{ zone_id: 'a', remote_agents: 4 }, { zone_id: 'b' }])).toEqual({ mode: 'company', company: 4, byZone: {} });
    expect(remoteReading(zones, [])).toEqual({ mode: 'company', company: 0, byZone: {} });
  });
  it('reads changes on other zones as per zone', () => {
    expect(remoteReading(zones, [{ zone_id: 'b', remote_agents: 2 }])).toEqual({ mode: 'zone', company: 0, byZone: { b: 2 } });
    expect(remoteReading(zones, [{ zone_id: 'a', remote_agents: 1 }, { zone_id: 'c', remote_agents: -3 }, { zone_id: 'x', remote_agents: 9 }])).toEqual({
      mode: 'zone',
      company: 0,
      byZone: { a: 1, c: -3 },
    });
  });
  it('both readings add up to one pool change', () => {
    const company = { mode: 'company', company: 5, byZone: { b: 9 } } as const;
    const perZone = { mode: 'zone', company: 7, byZone: { a: 2, b: 3, gone: 4 } } as const;
    expect(remoteDeltas(company, zones)).toEqual({ a: 5 });
    expect(remoteDeltas(perZone, zones)).toEqual({ a: 2, b: 3 });
    expect([remoteTotal(company, zones), remoteTotal(perZone, zones)]).toEqual([5, 5]);
    expect(remoteReading(zones, Object.entries(remoteDeltas(perZone, zones)).map(([zone_id, n]) => ({ zone_id, remote_agents: n })))).toEqual({
      mode: 'zone',
      company: 0,
      byZone: { a: 2, b: 3 },
    });
  });
});

describe('changeText', () => {
  const dict: Record<string, string> = { 'shift.DAY-A': 'Day A', 'chg.field': '{n} field', 'chg.share': 'Remote {p}%' };
  const m = Object.assign((key: string, values: Record<string, string | number> = {}) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k])), { has: (key: string) => key in dict });
  it('translates each part, keeping unknown pattern codes', () => {
    expect(changeText(m, { kind: 'field', n: 4 })).toBe('+4 field');
    expect(changeText(m, { kind: 'share', p: 35 })).toBe('Remote 35%');
    expect(changeText(m, { kind: 'pats', codes: ['DAY-A', 'X-1'] })).toBe('Day A / X-1');
    expect(patternLabel(m, 'X-1')).toBe('X-1');
  });
});

describe('signed', () => {
  it('always shows the sign of a change', () => {
    expect([signed(4), signed(-2), signed(0)]).toEqual(['+4', '-2', '0']);
  });
});
