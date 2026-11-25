// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover } from './popover';

afterEach(cleanup);

describe('Popover', () => {
  it('opens a labelled panel from its trigger and closes on Escape', () => {
    render(
      <Popover label="Filters" trigger={<button type="button">Filter</button>}>
        <input aria-label="Zone" />
      </Popover>,
    );
    const trigger = screen.getByRole('button', { name: 'Filter' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(trigger);
    const panel = screen.getByRole('dialog', { name: 'Filters' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('follows a controlled open state', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Popover open={false} onOpenChange={onOpenChange} trigger={<button type="button">More</button>}>
        Body
      </Popover>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText('Body')).toBeNull();
    rerender(
      <Popover open onOpenChange={onOpenChange} trigger={<button type="button">More</button>}>
        Body
      </Popover>,
    );
    expect(screen.getByText('Body')).toBeTruthy();
  });
});
