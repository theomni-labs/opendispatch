// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS, createLabelFn, interpolate, resolveLabel } from './labels';

describe('labels', () => {
  it('fill placeholders and leave unknown ones as written', () => {
    expect(interpolate('Page {page} of {pages}', { page: 2 })).toBe('Page 2 of {pages}');
  });

  it('look in the map, then the English defaults, then show the key', () => {
    const label = createLabelFn({ 'pagination.next': 'Onward' });
    expect(label('pagination.next')).toBe('Onward');
    expect(label('pagination.previous')).toBe('Previous page');
    expect(label('no.such.key')).toBe('no.such.key');
  });

  it('use plural rules in the function labels', () => {
    expect(resolveLabel({}, 'commandPalette.count', { count: 1 })).toBe('1 result');
    expect(resolveLabel({}, 'commandPalette.count', { count: 4 })).toBe('4 results');
    expect(
      resolveLabel({}, 'barChart.summary', { stacked: 1, horizontal: 0, categories: 1, seriesCount: 1, names: 'A', min: '0', max: '9' }),
    ).toBe('Stacked bar chart of 1 category for A, values from 0 to 9.');
    expect(typeof DEFAULT_LABELS['lineChart.summary']).toBe('function');
  });
});
