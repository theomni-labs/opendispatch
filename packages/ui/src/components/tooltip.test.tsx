// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './tooltip';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('shows after hover and describes its trigger', () => {
    render(
      <Tooltip content="Saved and audited">
        <button type="button">Status</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Status' });
    fireEvent.mouseEnter(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => void vi.advanceTimersByTime(300));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Saved and audited');
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('shows on keyboard focus and hides on Escape', () => {
    render(
      <Tooltip content="Why">
        <button type="button">Help</button>
      </Tooltip>,
    );
    act(() => screen.getByRole('button', { name: 'Help' }).focus());
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.getByRole('tooltip').textContent).toBe('Why');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('explains an aria-disabled control on click and stops the click', () => {
    const onClick = vi.fn();
    render(
      <Tooltip content="Your role cannot approve this">
        <button type="button" aria-disabled="true" onClick={onClick}>
          Approve
        </button>
      </Tooltip>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('tooltip').textContent).toBe('Your role cannot approve this');
  });

  it('renders only the child when there is no content', () => {
    render(
      <Tooltip content="">
        <button type="button">Plain</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Plain' }));
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
