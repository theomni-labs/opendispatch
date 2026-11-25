// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReasonSwitch } from './ReasonSwitch';
import { inLocale } from './test-utils';

afterEach(cleanup);

describe('ReasonSwitch', () => {
  it('is the plain Switch when there is no reason: it toggles', () => {
    const onChange = vi.fn();
    inLocale('en', <ReasonSwitch checked={false} aria-label="Allow" onCheckedChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Allow' }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(document.querySelector('[data-gated]')).toBeNull();
  });

  it('with a reason the switch is disabled, cannot toggle, and sits in a focusable wrapper that carries the reason as a tooltip', async () => {
    const onChange = vi.fn();
    inLocale('en', <ReasonSwitch reason="View only for this role" checked aria-label="Allow" onCheckedChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Allow' });
    expect(control.hasAttribute('disabled')).toBe(true);
    expect(control.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
    const wrap = document.querySelector('[data-gated]') as HTMLElement;
    expect(wrap.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(wrap);
    expect((await screen.findByRole('tooltip')).textContent).toBe('View only for this role');
  });

  it('the focusable wrapper has its own accessible name and disabled state, not only the tooltip', () => {
    inLocale('en', <ReasonSwitch reason="View only for this role" checked label="Allow" onCheckedChange={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Allow' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('tabindex')).toBe('0');
  });

  it('treats an empty or null reason as no reason', () => {
    for (const reason of [null, undefined, '']) {
      const view = inLocale('ar', <ReasonSwitch reason={reason} checked={false} aria-label="x" />);
      expect(screen.getByRole('switch', { name: 'x' }).hasAttribute('disabled')).toBe(false);
      view.unmount();
    }
  });

  it('keeps a switch that is disabled without a reason disabled', () => {
    inLocale('en', <ReasonSwitch disabled checked={false} aria-label="Off" />);
    expect(screen.getByRole('switch', { name: 'Off' }).hasAttribute('disabled')).toBe(true);
  });
});
