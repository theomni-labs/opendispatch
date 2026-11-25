// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  NAME_WIDTH_PX,
  ROSTER_BLOCK_KINDS,
  autoSlotWidth,
  columnsOf,
  fitBlockLabel,
  kindsPresent,
  minSlotWidth,
  slotFrom,
  slotSpan,
  slotsPerHour,
  tickLabel,
} from './roster-grid-geometry';

describe('slotsPerHour and columnsOf', () => {
  it('is 1 for an hourly grid and 4 for a 15-minute one', () => {
    expect(slotsPerHour(60)).toBe(1);
    expect(slotsPerHour(15)).toBe(4);
  });

  it('counts the columns of a day, at both resolutions', () => {
    expect(columnsOf(0, 24, 60)).toBe(24);
    expect(columnsOf(6, 30, 15)).toBe(96); // the mockup's night-shift day: 06:00 to 06:00 the next day
  });
});

describe('minSlotWidth and autoSlotWidth', () => {
  it('is wider for an hourly grid than a 15-minute one', () => {
    expect(minSlotWidth(60)).toBe(28);
    expect(minSlotWidth(15)).toBe(10);
  });

  it('fits the measured width, keeping the name column clear', () => {
    // 960px container, 24 columns: (960 - 176 - 2) / 24 = 32.58.., floored to 32.
    expect(autoSlotWidth(960, 24, 60)).toBe(32);
  });

  it('never goes narrower than the readable minimum, however little room there is', () => {
    expect(autoSlotWidth(0, 96, 15)).toBe(minSlotWidth(15));
    expect(autoSlotWidth(200, 96, 15)).toBe(minSlotWidth(15));
  });

  it('keeps NAME_WIDTH_PX in step with the CSS Module', () => {
    // RosterGrid.module.css's .grid sets --name-w to this same number.
    expect(NAME_WIDTH_PX).toBe(176);
  });
});

describe('slotFrom and slotSpan', () => {
  it('places a whole shift on 15-minute slots', () => {
    // Day A, 06:00 to 14:00, a grid that starts at 06:00: slot 0, 32 slots (8 hours).
    expect(slotFrom(6, 6, 15)).toBe(0);
    expect(slotSpan(6, 14, 15)).toBe(32);
  });

  it('places a break inside that shift', () => {
    // 11:15 to 11:45 is 5.25 hours into a grid starting at 06:00: slot 21, 2 slots (30 minutes).
    expect(slotFrom(11.25, 6, 15)).toBe(21);
    expect(slotSpan(11.25, 11.75, 15)).toBe(2);
  });

  it('places a night shift that runs past the grid’s own midnight', () => {
    // 22:00 to 06:00 the next day, on a grid from 06:00 to 30:00 (06:00 the day after): slot 64, 32 slots.
    expect(slotFrom(22, 6, 15)).toBe(64);
    expect(slotSpan(22, 30, 15)).toBe(32);
  });

  it('is at least one slot wide, so an instant still draws', () => {
    expect(slotSpan(6, 6, 15)).toBe(1);
  });

  it('is not thrown off by floating-point crumbs at a slot boundary', () => {
    // 0.1 + 0.2 style drift: still lands on slot 1, not 0 or 2.
    expect(slotFrom(6.25, 6, 60 / 4)).toBe(1);
  });
});

describe('tickLabel', () => {
  it('pads a single-digit hour and wraps past midnight, always in Western digits', () => {
    expect(tickLabel(6)).toBe('06');
    expect(tickLabel(14)).toBe('14');
    expect(tickLabel(24)).toBe('00');
    expect(tickLabel(27.5)).toBe('03');
  });
});

describe('kindsPresent', () => {
  it('lists only the kinds actually drawn, in the fixed legend order', () => {
    const rows = [
      { blocks: [{ kind: 'gap' as const }, { kind: 'shift' as const }] },
      { blocks: [{ kind: 'break' as const }] },
    ];
    expect(kindsPresent(rows)).toEqual(['shift', 'break', 'gap']);
  });

  it('is empty when there is nothing to draw', () => {
    expect(kindsPresent([])).toEqual([]);
    expect(kindsPresent([{ blocks: [] }])).toEqual([]);
  });

  it('never lists a kind outside the eight the grid knows', () => {
    expect(ROSTER_BLOCK_KINDS).toEqual(['shift', 'break', 'breakHolds', 'breakConflict', 'prayer', 'leave', 'override', 'gap']);
  });
});

describe('fitBlockLabel', () => {
  it('keeps a label that fits', () => {
    expect(fitBlockLabel('11:30', 80)).toBe('11:30');
  });

  it('shortens a clock time to its hour when the block is narrow, and drops it when even that does not fit', () => {
    expect(fitBlockLabel('11:30', 30)).toBe('11');
    expect(fitBlockLabel('11:30', 20)).toBe('');
  });

  it('leaves names to the block\'s own ellipsis', () => {
    expect(fitBlockLabel('Night shift B', 30)).toBe('Night shift B');
  });
});
