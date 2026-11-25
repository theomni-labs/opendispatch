// SPDX-License-Identifier: AGPL-3.0-only
// The pure part of TimeRibbon: the segments of a day and the arithmetic of hours. No React, so a Server Component can compute a
// ribbon's segments and hand them to the client component.

/** The chart colours, `--od-chart-1` to `--od-chart-6`. A segment takes one; the same tone for the same shift keeps the legend true. */
export type RibbonTone = 1 | 2 | 3 | 4 | 5 | 6;

export interface RibbonSegment {
  /** Hours from the start of the ribbon, `from` before `to`. */
  readonly from: number;
  readonly to: number;
  /** What the segment is (a shift, "Break"): its tooltip and its part of the text alternative. */
  readonly label: string;
  readonly tone?: RibbonTone | undefined;
  /** True when `label` is a record's own name (a shift pattern): it is data, so a translator must leave it alone. Default false: the label is text of the page. */
  readonly data?: boolean | undefined;
}

/** A stretch of hours as segments, split at midnight when it runs past it (`22 to 6` is `22 to 24` and `0 to 6`); `0` as an end is the end of the day. */
export function daySegments(from: number, to: number, label: string, tone?: RibbonTone, data?: boolean): RibbonSegment[] {
  const end = to === 0 ? 24 : to;
  if (end <= from) {
    return [
      { from, to: 24, label, tone, data },
      { from: 0, to: end, label, tone, data },
    ];
  }
  return [{ from, to: end, label, tone, data }];
}

/** `HH:MM` as hours (`06:30` is 6.5). */
export function hoursOf(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) + Number(minutes) / 60;
}

/** The room a tick label needs along the axis, in pixels: five digits and a gap. */
export const TICK_GAP_PX = 44;

/**
 * The hours to label on an axis `widthPx` wide: every `every` hours, or every second, third... one when the labels would touch.
 * The first and last hour are always there. Until the width is known (`null`) every tick shows.
 */
export function tickHours(start: number, end: number, every: number, widthPx: number | null, gapPx = TICK_GAP_PX): number[] {
  const span = end - start;
  const step = every > 0 ? every : span;
  const build = (multiple: number): number[] => {
    const ticks: number[] = [];
    for (let hour = start; hour <= end + 1e-9; hour += step * multiple) ticks.push(hour);
    if (ticks[ticks.length - 1] !== end) ticks.push(end);
    return ticks;
  };
  if (widthPx === null || span <= 0) return build(1);
  const maxMultiple = Math.max(Math.ceil(span / step), 1);
  for (let multiple = 1; multiple <= maxMultiple; multiple++) {
    const ticks = build(multiple);
    const room = ticks.every((hour, index) => index === 0 || ((hour - (ticks[index - 1] ?? hour)) / span) * widthPx >= gapPx);
    if (room) return ticks;
  }
  return [start, end];
}
