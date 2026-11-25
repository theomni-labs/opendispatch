// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cx } from './cx';

describe('cx', () => {
  it('joins the class names that are on and skips the rest', () => {
    expect(cx('a', undefined, false, null, 'b', '')).toBe('a b');
    expect(cx()).toBe('');
    const on = false as boolean;
    expect(cx('a', on && 'b')).toBe('a');
  });
});
