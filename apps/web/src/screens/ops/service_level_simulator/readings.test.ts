// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { readingOrder, sharesInOrder } from './readings';

describe('readingOrder', () => {
  it('leads with from assignment when the setting says so', () => {
    expect(readingOrder(true)).toEqual(['fromAssignment', 'fromRegistration']);
    expect(sharesInOrder(true, 0.7, 0.6)).toEqual([0.7, 0.6]);
  });
  it('leads with from registration otherwise', () => {
    expect(readingOrder(false)).toEqual(['fromRegistration', 'fromAssignment']);
    expect(sharesInOrder(false, 0.7, 0.6)).toEqual([0.6, 0.7]);
  });
});
