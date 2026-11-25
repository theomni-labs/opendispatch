// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { pickFields, pickText, pickTextList } from './pick';

describe('pickFields', () => {
  it('copies only the named keys that the input has', () => {
    expect(pickFields({ email: 'a@b.c', role: 'administrator', zone_ids: [] }, ['email', 'zone_ids'])).toEqual({ email: 'a@b.c', zone_ids: [] });
  });

  it('gives {} for anything that is not a plain object', () => {
    for (const bad of [null, undefined, 'x', 7, ['email'], () => 1]) expect(pickFields(bad, ['email'])).toEqual({});
  });

  it('never copies an inherited or prototype key', () => {
    const input = JSON.parse('{"__proto__":{"email":"x"},"email":"ok"}') as unknown;
    const picked = pickFields(input, ['email', '__proto__', 'toString']);
    expect(picked).toEqual({ email: 'ok' });
    expect(Object.getPrototypeOf(picked)).toBe(Object.prototype);
    expect(pickFields(Object.create({ email: 'inherited' }), ['email'])).toEqual({});
  });

  it('leaves the values for the data layer to validate', () => {
    expect(pickFields({ email: 42 }, ['email'])).toEqual({ email: 42 });
  });
});

describe('pickText and pickTextList', () => {
  it('returns a string field, and undefined for anything else', () => {
    expect(pickText({ note: 'hi' }, 'note')).toBe('hi');
    expect(pickText({ note: 3 }, 'note')).toBeUndefined();
    expect(pickText(null, 'note')).toBeUndefined();
  });

  it('returns a list of strings, at most `max` long', () => {
    expect(pickTextList({ ids: ['a', 'b'] }, 'ids')).toEqual(['a', 'b']);
    expect(pickTextList({ ids: ['a', 2] }, 'ids')).toBeUndefined();
    expect(pickTextList({ ids: 'a' }, 'ids')).toBeUndefined();
    expect(pickTextList({ ids: ['a', 'b', 'c'] }, 'ids', 2)).toBeUndefined();
    expect(pickTextList({}, 'ids')).toBeUndefined();
  });
});
