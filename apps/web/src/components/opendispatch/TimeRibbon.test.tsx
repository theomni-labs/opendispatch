// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { tickHours } from './ribbon-geometry';
import { daySegments, hoursOf, TimeRibbon } from './TimeRibbon';
import { hasArabicIndicDigits, inLocale } from './test-utils';

afterEach(cleanup);

describe('daySegments and hoursOf', () => {
  it('keeps a stretch inside the day as one segment', () => {
    expect(daySegments(6, 14, 'Day A', 1)).toEqual([{ from: 6, to: 14, label: 'Day A', tone: 1 }]);
  });

  it('splits a stretch that runs past midnight, and reads 00:00 as the end of the day', () => {
    expect(daySegments(22, 6, 'Night', 5)).toEqual([
      { from: 22, to: 24, label: 'Night', tone: 5 },
      { from: 0, to: 6, label: 'Night', tone: 5 },
    ]);
    expect(daySegments(18, 0, 'Evening')).toEqual([{ from: 18, to: 24, label: 'Evening', tone: undefined }]);
  });

  it('carries the data flag of a record name into every piece of a split segment', () => {
    expect(daySegments(22, 6, 'Night', 5, true)).toEqual([
      { from: 22, to: 24, label: 'Night', tone: 5, data: true },
      { from: 0, to: 6, label: 'Night', tone: 5, data: true },
    ]);
  });

  it('reads a clock time as hours', () => {
    expect(hoursOf('06:30')).toBe(6.5);
    expect(hoursOf('00:00')).toBe(0);
    expect(hoursOf('23:45')).toBe(23.75);
  });
});

describe('TimeRibbon', () => {
  const segments = [
    { from: 6, to: 11, label: 'Day A', tone: 1 as const },
    { from: 11, to: 11.5, label: 'Break', tone: 4 as const },
    { from: 11.5, to: 14, label: 'Day A', tone: 1 as const },
  ];

  it('draws each segment at its share of the day, with its label as the tooltip, in an image named by the caller', () => {
    const { container } = inLocale('en', <TimeRibbon label="Field shifts" segments={segments} tickEvery={6} />);
    const track = screen.getByRole('img', { name: 'Field shifts' });
    const drawn = [...track.querySelectorAll<HTMLElement>('span[title]')];
    expect(drawn.map((s) => s.getAttribute('title'))).toEqual(['Day A', 'Break', 'Day A']);
    expect(drawn[0]?.style.insetInlineStart).toBe('25%');
    expect(parseFloat(drawn[0]?.style.inlineSize ?? '')).toBeCloseTo(20.8333, 3);
    expect(parseFloat(drawn[1]?.style.insetInlineStart ?? '')).toBeCloseTo(45.8333, 3);
    expect(container.textContent).toContain('Day A 06:00 - 11:00, Break 11:00 - 11:30, Day A 11:30 - 14:00');
  });

  it('marks a record name (data: true) translate="no" in the tooltip and in the text alternative, and leaves the page text (Break) alone', () => {
    const named = [
      { from: 6, to: 11, label: 'Day A', tone: 1 as const, data: true },
      { from: 11, to: 11.5, label: 'Break', tone: 4 as const },
    ];
    const { container } = inLocale('en', <TimeRibbon label="Field shifts" segments={named} tickEvery={6} />);
    const [day, rest] = [...container.querySelectorAll<HTMLElement>('span[title]')];
    expect(day?.getAttribute('translate')).toBe('no');
    expect(rest?.getAttribute('translate')).toBeNull();
    const summary = container.querySelector<HTMLElement>('[id]:not([role])');
    expect(summary?.textContent).toBe('Day A 06:00 - 11:00, Break 11:00 - 11:30');
    expect([...(summary?.querySelectorAll('span[translate="no"]') ?? [])].map((node) => node.textContent)).toEqual(['Day A']);
  });

  it('puts a time tick every so many hours, first and last included', () => {
    const { container } = inLocale('en', <TimeRibbon label="Day" segments={segments} tickEvery={6} />);
    const ticks = [...container.querySelectorAll('[aria-hidden="true"] span')].map((t) => t.textContent);
    expect(ticks).toEqual(['00:00', '06:00', '12:00', '18:00', '00:00']);
  });

  it('shows a range other than a whole day', () => {
    const { container } = inLocale('en', <TimeRibbon label="Morning" start={6} end={14} tickEvery={2} segments={[{ from: 6, to: 14, label: 'Day A', tone: 1 }]} />);
    expect([...container.querySelectorAll('[aria-hidden="true"] span')].map((t) => t.textContent)).toEqual(['06:00', '08:00', '10:00', '12:00', '14:00']);
    expect((container.querySelector('span[title]') as HTMLElement).style.inlineSize).toBe('100%');
  });

  it('is left to right in Arabic too, with Western digits, and a segment outside the range is clipped to it', () => {
    const { container } = inLocale('ar', <TimeRibbon label="اليوم" segments={[{ from: -2, to: 30, label: 'ب' }]} />);
    expect(container.querySelector('[dir="ltr"]')).not.toBeNull();
    expect(hasArabicIndicDigits(container.textContent ?? '')).toBe(false);
    const segment = container.querySelector('span[title]') as HTMLElement;
    expect(segment.style.insetInlineStart).toBe('0%');
    expect(segment.style.inlineSize).toBe('100%');
    expect(screen.getByRole('img', { name: 'اليوم' })).toBeTruthy();
  });

  it('draws an empty day as an empty track (no segments, no error)', () => {
    inLocale('en', <TimeRibbon label="Remote" segments={[]} />);
    expect(screen.getByRole('img', { name: 'Remote' }).querySelectorAll('span[title]')).toHaveLength(0);
  });
});

describe('tickHours', () => {
  it('keeps every tick when they fit, or when the width is not known yet', () => {
    expect(tickHours(0, 24, 3, null)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24]);
    expect(tickHours(0, 24, 3, 900)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24]);
  });

  it('thins the ticks on a narrow axis so no two labels are closer than the gap', () => {
    const ticks = tickHours(0, 24, 3, 300);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(24);
    expect(ticks.length).toBeLessThan(9);
    for (let i = 1; i < ticks.length; i++) expect(((ticks[i]! - ticks[i - 1]!) / 24) * 300).toBeGreaterThanOrEqual(44);
  });

  it('always has the first and last hour, even on a tiny axis', () => {
    expect(tickHours(0, 24, 3, 60)).toEqual([0, 24]);
  });
});
