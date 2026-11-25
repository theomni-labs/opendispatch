// SPDX-License-Identifier: AGPL-3.0-only
// Whether a horizontally scrolling box has more to show at its inline end. Pure, so it can be tested without layout.

export interface ScrollMetrics {
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/** Sub-pixel rounding leaves a gap this small at the far end. */
const TOLERANCE = 2;

/** `more`: content is hidden past the inline end. `none`: it all fits, or the end is already showing. */
export function scrollCue({ scrollLeft, scrollWidth, clientWidth }: ScrollMetrics): 'more' | 'none' {
  // In a right-to-left box scrollLeft counts back from zero, so the distance travelled is its absolute value.
  const travelled = Math.abs(scrollLeft);
  return scrollWidth - clientWidth - travelled > TOLERANCE ? 'more' : 'none';
}
