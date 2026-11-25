// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { ToastProvider, useToast, type ToastOptions } from './toast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Trigger({ options }: { options: ToastOptions }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast(options)}>
      Show
    </button>
  );
}

describe('ToastProvider and useToast', () => {
  it('announces a notice in a labelled live region with role status', () => {
    render(
      <ToastProvider>
        <Trigger options={{ title: 'Saved', description: 'The rule is live.', tone: 'success' }} />
      </ToastProvider>,
    );
    expect(screen.getByRole('region', { name: 'Notifications' }).getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Saved');
    expect(status.textContent).toContain('The rule is live.');
  });

  it('uses role alert for the danger tone', () => {
    render(
      <ToastProvider>
        <Trigger options={{ title: 'Failed', tone: 'danger' }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('alert').textContent).toContain('Failed');
  });

  it('goes after its duration, or when dismissed', () => {
    render(
      <ToastProvider>
        <Trigger options={{ title: 'Copied' }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    act(() => void vi.advanceTimersByTime(4600));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('can be destructured and returns an id that dismisses', () => {
    const held: { api?: ReturnType<typeof useToast> } = {};
    function Grab() {
      const api = useToast();
      useEffect(() => {
        held.api = api;
      });
      return null;
    }
    render(
      <ToastProvider>
        <Grab />
      </ToastProvider>,
    );
    let id = '';
    act(() => {
      id = held.api?.toast({ title: 'Hello', duration: 0 }) ?? '';
    });
    expect(screen.getByRole('status').textContent).toContain('Hello');
    act(() => held.api?.dismiss(id));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
