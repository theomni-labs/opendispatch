// SPDX-License-Identifier: AGPL-3.0-only
// Which reading leads: pure.

export type ReadingKey = 'fromAssignment' | 'fromRegistration';

/** Primary first, from the clock-start setting. */
export function readingOrder(primaryIsAssignment: boolean): readonly [ReadingKey, ReadingKey] {
  return primaryIsAssignment ? ['fromAssignment', 'fromRegistration'] : ['fromRegistration', 'fromAssignment'];
}

/** A row's two shares, primary first. */
export function sharesInOrder<T>(primaryIsAssignment: boolean, fromAssignment: T, fromRegistration: T): readonly [T, T] {
  return primaryIsAssignment ? [fromAssignment, fromRegistration] : [fromRegistration, fromAssignment];
}
