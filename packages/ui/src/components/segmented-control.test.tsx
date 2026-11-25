// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './segmented-control';

afterEach(cleanup);

const OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

describe('SegmentedControl', () => {
  it('is a radiogroup of radios with aria-checked and one tab stop', () => {
    const onChange = vi.fn();
    render(<SegmentedControl ariaLabel="Period" options={OPTIONS} value="week" onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Period' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(onChange).toHaveBeenCalledWith('month');
  });

  it('moves with the arrow keys when uncontrolled', () => {
    render(<SegmentedControl aria-label="Period" options={OPTIONS} />);
    const [day] = screen.getAllByRole('radio');
    fireEvent.keyDown(day as HTMLElement, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Week' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Week' }), { key: 'End' });
    expect(screen.getByRole('radio', { name: 'Month' }).getAttribute('aria-checked')).toBe('true');
  });
});
