// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '../provider';
import { BarChart, HeatGrid, LineChart } from './index';

afterEach(cleanup);

describe('LineChart', () => {
  it('names the drawing with the title and a summary of the series, range and markers', () => {
    render(
      <LineChart
        label="Calls"
        labels={['08:00', '', '10:00']}
        series={[
          { name: 'Forecast', data: [3, 9, 6] },
          { name: 'Actual', data: [4, 8, 5], dashed: true },
        ]}
        markers={[{ index: 1, label: 'Now' }]}
      />,
    );
    expect(
      screen.getByRole('img', {
        name: 'Calls. Line chart of Forecast, Actual across 3 points from 08:00 to 10:00, values from 3 to 9. Markers: Now.',
      }),
    ).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Forecast',
      'Actual',
    ]);
  });

  it('adds the band to the legend and says when there is no data', () => {
    const { rerender } = render(
      <LineChart labels={['a', 'b']} series={[{ name: 'Demand', data: [1, 2] }]} band={{ low: [0, 1], high: [2, 3] }} />,
    );
    expect(screen.getByText('Likely range')).toBeTruthy();
    rerender(<LineChart label="Calls" labels={[]} series={[]} />);
    expect(screen.getByRole('img', { name: 'Calls. No data' }).textContent).toBe('No data');
  });
});

describe('BarChart', () => {
  it('summarises a grouped chart with the formatted range', () => {
    render(
      <BarChart
        label="Week"
        data={[
          { label: 'Sun', values: [10, 20] },
          { label: 'Mon', values: [30, 5] },
        ]}
        series={[{ name: 'To scene' }, { name: 'On scene' }]}
        format={(n) => `${String(n)} min`}
      />,
    );
    expect(
      screen.getByRole('img', {
        name: 'Week. Grouped bar chart of 2 categories and 2 series (To scene, On scene), values from 0 min to 30 min.',
      }),
    ).toBeTruthy();
  });
});

describe('HeatGrid', () => {
  const props = {
    rows: ['North', 'South'],
    columns: ['08', '09'],
    values: [
      [-2, 0],
      [3, null],
    ],
    kind: 'signed' as const,
    label: 'Gaps',
  };

  it('is a grid whose cells carry their row, column, value and kind', () => {
    render(<HeatGrid {...props} />);
    const grid = screen.getByRole('grid', { name: 'Gaps. Heat grid of 2 rows by 2 columns, values -2 to 3.' });
    expect(within(grid).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['08', '09']);
    expect(within(grid).getByRole('gridcell', { name: 'North, 08: -2, Gap' })).toBeTruthy();
    expect(within(grid).getByRole('gridcell', { name: 'North, 09: 0, Balanced' })).toBeTruthy();
    expect(within(grid).getByRole('gridcell', { name: 'South, 09: no value' })).toBeTruthy();
  });

  it('moves with the arrow keys, mirrored in right to left, and selects with Enter', () => {
    const onCellSelect = vi.fn();
    render(
      <DesignSystemProvider dir="rtl">
        <HeatGrid {...props} onCellSelect={onCellSelect} />
      </DesignSystemProvider>,
    );
    const grid = screen.getByRole('grid');
    const first = within(grid).getByRole('gridcell', { name: 'North, 08: -2, Gap' });
    first.focus();
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('North, 09: 0, Balanced');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onCellSelect).toHaveBeenCalledWith({ row: 1, column: 0, value: 3, kind: 'surplus' });
  });
});
