// SPDX-License-Identifier: AGPL-3.0-only
// RosterGrid's maths, kept DOM-free for testing.

/** Pixels of the sticky name column; RosterGrid.module.css's --name-w must match. */
export const NAME_WIDTH_PX = 176;
/** The border between the name column and the track, that the mockup subtracts before fitting columns. */
const SLOT_SLACK_PX = 2;

/** Rounds to 2 decimals first, like the mockup kit, so a slot boundary is never off by a floating-point crumb. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** How many columns make one hour, for a step of `stepMin` minutes. */
export function slotsPerHour(stepMin: number): number {
  return 60 / stepMin;
}

/** How many time columns the grid has, from `startHour` to `endHour`. */
export function columnsOf(startHour: number, endHour: number, stepMin: number): number {
  return Math.round((endHour - startHour) * slotsPerHour(stepMin));
}

/** The narrowest a column may be: wider for an hourly grid than a 15-minute one. */
export function minSlotWidth(stepMin: number): number {
  return stepMin === 60 ? 28 : 10;
}

/** A column width fitted to the measured container, never narrower than `minSlotWidth`. */
export function autoSlotWidth(measuredWidth: number, columns: number, stepMin: number): number {
  const fit = Math.floor((measuredWidth - NAME_WIDTH_PX - SLOT_SLACK_PX) / Math.max(columns, 1));
  return Math.max(minSlotWidth(stepMin), fit);
}

/** The `--from` grid line of an hour: the slot it starts in. */
export function slotFrom(hours: number, startHour: number, stepMin: number): number {
  return Math.floor(round2((hours - startHour) * slotsPerHour(stepMin) + 0.001));
}

/** The `--span` of a stretch of hours: at least one slot, so an instant still draws. */
export function slotSpan(fromHours: number, toHours: number, stepMin: number): number {
  return Math.max(1, Math.ceil(round2((toHours - fromHours) * slotsPerHour(stepMin) - 0.001)));
}

/** The bare hour of a tick label ("06"), wrapping past midnight; built by hand so the digits are always Western. */
export function tickLabel(hour: number): string {
  return String(Math.floor(hour) % 24).padStart(2, '0');
}

// Break Planner's own two hold/conflict kinds.
export type RosterBlockKind = 'shift' | 'break' | 'breakHolds' | 'breakConflict' | 'prayer' | 'leave' | 'override' | 'gap';
/** The legend's and the CSS's fixed order. */
export const ROSTER_BLOCK_KINDS: readonly RosterBlockKind[] = ['shift', 'break', 'breakHolds', 'breakConflict', 'prayer', 'leave', 'override', 'gap'];

/** The kinds actually drawn, in the canonical order, so the legend never lists a kind that is not on the grid. */
export function kindsPresent(rows: readonly { blocks: readonly { kind: RosterBlockKind }[] }[]): RosterBlockKind[] {
  const present = new Set<RosterBlockKind>();
  for (const row of rows) for (const block of row.blocks) present.add(block.kind);
  return ROSTER_BLOCK_KINDS.filter((kind) => present.has(kind));
}

/** Pixels one character of a block label takes (12px tabular text), and the padding and borders around it. */
const LABEL_CHAR_PX = 7;
const BLOCK_CHROME_PX = 14;

/**
 * What to write in a block `widthPx` wide. A clock time ("11:30") that does not fit becomes its hour ("11"), and nothing
 * when even that does not fit, instead of clipping to "11:". Other labels are left to the block's own ellipsis.
 */
export function fitBlockLabel(label: string, widthPx: number): string {
  const room = widthPx - BLOCK_CHROME_PX;
  if (label.length * LABEL_CHAR_PX <= room) return label;
  if (!/^\d{1,2}:\d{2}$/.test(label)) return label;
  const hour = label.split(':')[0] ?? '';
  return hour.length * LABEL_CHAR_PX <= room ? hour : '';
}
