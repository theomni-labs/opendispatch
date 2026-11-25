// SPDX-License-Identifier: AGPL-3.0-only
// The clock the screen leads with: pure.

export type ClockKey = 'a' | 'r';

/** The setting's clock: assignment unless registration. */
export function primaryClock(clockStart: string): ClockKey {
  return clockStart === 'registration' ? 'r' : 'a';
}

/** The asked clock, else the setting's. */
export function chosenClock(asked: string | undefined, clockStart: string): ClockKey {
  return asked === 'a' || asked === 'r' ? asked : primaryClock(clockStart);
}

/** The two clock columns, primary first. */
export function clockOrder(primary: ClockKey): readonly [ClockKey, ClockKey] {
  return primary === 'a' ? ['a', 'r'] : ['r', 'a'];
}
