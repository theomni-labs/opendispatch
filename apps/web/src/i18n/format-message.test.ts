// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatMessage } from './format-message';

const GAPS = '{n, plural, zero {+{n} فترة عجز} one {+{n} فترة عجز} two {+{n} فترتا عجز} few {+{n} فترات عجز} many {+{n} فترة عجز} other {+{n} فترة عجز}}';

describe('formatMessage', () => {
  it('picks the Arabic plural form', () => {
    expect(formatMessage('ar', GAPS, { n: 2 })).toBe('+2 فترتا عجز');
    expect(formatMessage('ar', GAPS, { n: 3 })).toBe('+3 فترات عجز');
    expect(formatMessage('ar', GAPS, { n: 100 })).toBe('+100 فترة عجز');
  });

  it('fills plain holes in English', () => {
    expect(formatMessage('en', '{add} cases added, {upd} updated.', { add: 3, upd: 0 })).toBe('3 cases added, 0 updated.');
  });

  it('throws when a value is missing', () => {
    expect(() => formatMessage('en', '{n} of {total} shown', { n: 1 })).toThrow();
  });
});
