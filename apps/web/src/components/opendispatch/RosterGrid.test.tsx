// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RosterGrid, type RosterGridProps, type RosterRow } from './RosterGrid';
import { hasArabicIndicDigits, hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(cleanup);

const ROWS: RosterRow[] = [
  {
    id: 'L007',
    name: 'Mansour Al-Barati',
    sub: 'Day A · SYN 6003',
    blocks: [
      { kind: 'shift', from: 6, to: 14, label: 'Day A' },
      { kind: 'break', from: 11, to: 12, label: '', tip: 'Break 11:00 to 12:00' },
    ],
  },
  {
    id: 'L013',
    name: 'Adel Al-Fariri',
    sub: 'Day B · SYN 9469',
    blocks: [{ kind: 'leave', from: 6, to: 14, label: 'Unavailable' }],
  },
  {
    id: 'gap-row',
    name: 'Gap',
    nameIsData: false,
    sub: '2 intervals',
    subIsData: false,
    blocks: [{ kind: 'gap', from: 9, to: 10, label: '-2' }],
  },
];
function renderGrid(props: Partial<RosterGridProps> = {}, locale: 'en' | 'ar' = 'en') {
  return inLocale(locale, <RosterGrid rows={ROWS} headLabel="Agent" startHour={6} endHour={14} stepMin={60} {...props} />);
}

const tracks = (container: Element) => [...container.querySelectorAll('[role="img"]')] as HTMLElement[];
const blocksOf = (track: Element) => [...track.querySelectorAll('span[title]')] as HTMLElement[];

describe('RosterGrid: filled', () => {
  it('draws the header ticks and one track per row, each named for its agent', () => {
    const { container } = renderGrid({ label: 'Riyadh Central roster' });
    expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('filled');
    // startHour 6, endHour 14: eight hourly ticks, 06 to 13.
    expect(screen.getAllByText(/^(0[6-9]|1[0-3])$/).map((node) => node.textContent)).toEqual(['06', '07', '08', '09', '10', '11', '12', '13']);
    const rowTracks = tracks(container);
    expect(rowTracks).toHaveLength(3);
    expect(rowTracks.map((track) => track.getAttribute('aria-label'))).toEqual(['Mansour Al-Barati', 'Adel Al-Fariri', 'Gap']);
  });

  it('shows the name and the sub line of each row', () => {
    renderGrid();
    expect(screen.getByText('Mansour Al-Barati')).toBeTruthy();
    expect(screen.getByText('Day A · SYN 6003')).toBeTruthy();
    // "Gap" is also the legend's label for the gap block kind, so scope to the row name.
    expect(screen.getAllByText('Gap').some((node) => node.tagName === 'B')).toBe(true);
    expect(screen.getByText('2 intervals')).toBeTruthy();
  });

  it('marks an agent’s own name untranslatable by default, and a summary row’s own text not', () => {
    const { container } = renderGrid();
    const nameEl = (text: string) => [...container.querySelectorAll('b')].find((node) => node.textContent === text);
    expect(nameEl('Mansour Al-Barati')?.getAttribute('translate')).toBe('no');
    expect(nameEl('Gap')?.hasAttribute('translate')).toBe(false);
  });

  it('places a block with the right column and width, in slots from the grid’s own start hour', () => {
    const { container } = renderGrid({ stepMin: 15 });
    const shiftBlock = blocksOf(tracks(container)[0] as HTMLElement)[0] as HTMLElement;
    // Day A, 06:00 to 14:00, a 15-minute grid starting at 06:00: slot 0, 32 slots (8 hours).
    expect(shiftBlock.style.getPropertyValue('--from')).toBe('0');
    expect(shiftBlock.style.getPropertyValue('--span')).toBe('32');
  });

  it('carries an explicit tip, and falls back to the label and the time range without one', () => {
    const { container } = renderGrid();
    const [shiftBlock, breakBlock] = blocksOf(tracks(container)[0] as HTMLElement);
    expect(shiftBlock?.getAttribute('title')).toBe('Day A 06:00–14:00');
    expect(breakBlock?.getAttribute('title')).toBe('Break 11:00 to 12:00');
  });

  it('gives each row a text alternative of its blocks, for a screen reader', () => {
    const { container } = renderGrid();
    const track = tracks(container)[0] as HTMLElement;
    const described = container.querySelector(`#${track.getAttribute('aria-describedby')}`);
    expect(described?.textContent).toBe('Day A, 06:00–14:00. , 11:00–12:00');
  });

  it('has no description for a row with no blocks', () => {
    const { container } = renderGrid({ rows: [{ id: 'x', name: 'Nobody', blocks: [] }] });
    const track = tracks(container)[0] as HTMLElement;
    expect(track.hasAttribute('aria-describedby')).toBe(false);
  });

  it('marks a block’s own data value untranslatable, and leaves page text translatable', () => {
    const { container } = renderGrid({
      rows: [{ id: 'x', name: 'X', blocks: [{ kind: 'override', from: 6, to: 7, label: 'Sara Al-Habuli', data: true }] }],
    });
    const dataBlock = blocksOf(tracks(container)[0] as HTMLElement)[0] as HTMLElement;
    expect(dataBlock.getAttribute('translate')).toBe('no');

    cleanup();
    const { container: other } = renderGrid({ rows: [{ id: 'y', name: 'Y', blocks: [{ kind: 'shift', from: 6, to: 7, label: 'Day A' }] }] });
    const pageTextBlock = blocksOf(tracks(other)[0] as HTMLElement)[0] as HTMLElement;
    expect(pageTextBlock.hasAttribute('translate')).toBe(false);
  });

  it('lists only the block kinds actually drawn, in a fixed order, and none for override', () => {
    renderGrid();
    const legend = screen.getByRole('list', { name: 'Roster grid' });
    expect(within(legend).getAllByRole('listitem').map((node) => node.textContent)).toEqual(['Shift', 'Break', 'Leave', 'Gap']);
  });

  it('hides the legend when asked to', () => {
    renderGrid({ legend: false });
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('is named "Roster grid" when no label is given', () => {
    renderGrid();
    expect(screen.getByRole('list').getAttribute('aria-label')).toBe('Roster grid');
  });
});

describe('RosterGrid: usable at scale', () => {
  it('draws every row without dropping any, for a full 330-agent roster', () => {
    const many: RosterRow[] = Array.from({ length: 330 }, (_, i) => ({
      id: `S${i}`,
      name: `Agent ${i}`,
      blocks: [{ kind: 'shift' as const, from: 6, to: 14, label: 'Day A' }],
    }));
    const { container } = renderGrid({ rows: many });
    expect(tracks(container)).toHaveLength(330);
  });
});

describe('RosterGrid: column width', () => {
  it('uses a fixed slotWidth when given, however wide the container', () => {
    const { container } = renderGrid({ slotWidth: 40 });
    const grid = container.querySelector('[style*="--slot-w"]') as HTMLElement;
    expect(grid.style.getPropertyValue('--slot-w')).toBe('40px');
    expect(grid.style.getPropertyValue('--cols')).toBe('8');
  });

  it('falls back to the readable minimum before the container is measured', () => {
    const { container } = renderGrid({ stepMin: 15 });
    const grid = container.querySelector('[style*="--slot-w"]') as HTMLElement;
    expect(grid.style.getPropertyValue('--slot-w')).toBe('10px');
    const { container: hourly } = renderGrid();
    const hourlyGrid = hourly.querySelector('[style*="--slot-w"]') as HTMLElement;
    expect(hourlyGrid.style.getPropertyValue('--slot-w')).toBe('28px');
  });
});

describe('RosterGrid: the hour axis follows the page direction', () => {
  const gridOf = (container: Element) => container.querySelector('[style*="--cols"]') as HTMLElement;

  it('forces no direction on any track, so Arabic mirrors the axis and the bars sit by their names', () => {
    const { container } = renderGrid();
    expect(gridOf(container).querySelectorAll('[dir]')).toHaveLength(0);
    for (const track of tracks(container)) expect(track.getAttribute('dir')).toBeNull();
    cleanup();
    const { container: ar } = renderGrid({}, 'ar');
    expect(gridOf(ar).querySelectorAll('[dir]')).toHaveLength(0);
  });
});

describe('RosterGrid: Arabic', () => {
  // Row and block content is the caller's own data (English here, as the fixture happens to be); only the grid's
  // own chrome, the legend and the header ticks, is this component's to translate.
  it('names the block kinds in the legend in Arabic, and keeps the header ticks in Western digits', () => {
    const { container } = renderGrid({}, 'ar');
    const legend = screen.getByRole('list');
    expect(hasLatinLetters(readableText(legend))).toBe(false);
    expect(hasArabicIndicDigits(readableText(legend))).toBe(false);
    expect(screen.getByText('وردية')).toBeTruthy();
    expect(screen.getByText('استراحة')).toBeTruthy();
    expect(screen.getByText('إجازة')).toBeTruthy();
    expect(screen.getByText('عجز')).toBeTruthy();
    const firstTick = container.querySelector('[style*="--from: 0"]');
    expect(firstTick?.textContent).toBe('06');
  });
});

describe('RosterGrid: loading, empty and error', () => {
  it('shows a skeleton while loading, announced, with no track drawn', () => {
    const { container } = renderGrid({ state: 'loading' });
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain('Loading');
    expect(tracks(container)).toHaveLength(0);
    cleanup();
    renderGrid({ state: 'loading' }, 'ar');
    expect(screen.getByRole('status').textContent).toContain('جارٍ التحميل');
  });

  it('says so when there are no rows', () => {
    const { container } = renderGrid({ rows: [] });
    expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('No roster to show')).toBeTruthy();
    expect(tracks(container)).toHaveLength(0);
    cleanup();
    renderGrid({ rows: [] }, 'ar');
    expect(screen.getByText('لا يوجد جدول لعرضه')).toBeTruthy();
  });

  it('shows the error, announced, with a retry only when it can retry', () => {
    const onRetry = vi.fn();
    const { container } = renderGrid({ state: 'error', onRetry });
    expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('The roster could not be drawn');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    cleanup();
    renderGrid({ state: 'error' });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('writes the error and the retry in Arabic', () => {
    renderGrid({ state: 'error', onRetry: () => undefined }, 'ar');
    expect(screen.getByRole('alert').textContent).toContain('تعذّر رسم الجدول');
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
  });
});

describe('RosterGrid: selectable blocks and bands', () => {
  const rows: RosterRow[] = [
    {
      id: 'a1',
      name: 'Mansour Al-Barati',
      blocks: [
        { kind: 'shift', from: 6, to: 14, label: 'Day A' },
        { kind: 'breakConflict', from: 11, to: 11.5, label: '11:00', selectable: true },
      ],
    },
    { id: 'prayer-row', name: 'Prayer window', nameIsData: false, blocks: [{ kind: 'prayer', from: 11.75, to: 12, label: 'Dhuhr 11:45' }] },
  ];

  it('draws a selectable block as a named button that calls onBlockSelect with the row', () => {
    const onBlockSelect = vi.fn();
    renderGrid({ rows, onBlockSelect, selectLabel: 'Adjust break' });
    fireEvent.click(screen.getByRole('button', { name: /^Adjust break, Mansour Al-Barati, / }));
    expect(onBlockSelect).toHaveBeenCalledWith('a1', expect.objectContaining({ kind: 'breakConflict' }));
    expect(screen.getByRole('group', { name: 'Mansour Al-Barati' })).toBeTruthy();
  });

  it('without onBlockSelect a selectable block stays a picture', () => {
    renderGrid({ rows });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shades every body row for each band, and lists the prayer kind in the legend', () => {
    const { container } = renderGrid({ rows, bands: [{ from: 11.75, to: 12 }] });
    expect(container.querySelectorAll('span[aria-hidden="true"][style*="--from"]')).toHaveLength(2);
    expect(screen.getAllByText('Prayer window').length).toBeGreaterThanOrEqual(2);
  });
});
