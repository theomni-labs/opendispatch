// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { chosenClock, clockOrder, primaryClock } from './clock';

describe('the leading clock follows the setting', () => {
  it('is from assignment unless the setting says registration', () => {
    expect(primaryClock('assignment')).toBe('a');
    expect(primaryClock('registration')).toBe('r');
  });
  it('defaults the distribution to the setting, keeping an asked clock', () => {
    expect(chosenClock(undefined, 'registration')).toBe('r');
    expect(chosenClock(undefined, 'assignment')).toBe('a');
    expect(chosenClock('a', 'registration')).toBe('a');
    expect(chosenClock('x', 'registration')).toBe('r');
  });
  it('puts the primary column first', () => {
    expect(clockOrder('a')).toEqual(['a', 'r']);
    expect(clockOrder('r')).toEqual(['r', 'a']);
  });
});
