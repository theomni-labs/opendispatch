// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { pathSegment } from './path-segment';

describe('pathSegment', () => {
  it('passes an id through and encodes anything else as one segment', () => {
    expect(pathSegment('00000000-0000-4000-8000-000000000001')).toBe('00000000-0000-4000-8000-000000000001');
    expect(pathSegment('RULE-003')).toBe('RULE-003');
    expect(pathSegment('../../etc/passwd')).toBe('..%2F..%2Fetc%2Fpasswd');
    expect(pathSegment(' ')).toBe('%20');
    expect(pathSegment(123)).toBe('123');
    expect(pathSegment(10n)).toBe('10');
  });

  it('sends `-` for what a URL would drop or a value that is not text', () => {
    for (const junk of ['', '.', '..', null, undefined, {}, [], ['RULE-001'], true, Symbol('id'), Object.create(null)]) expect(pathSegment(junk)).toBe('-');
  });

  it('keeps at most 128 characters', () => {
    expect(pathSegment('a'.repeat(300))).toHaveLength(128);
  });
});
