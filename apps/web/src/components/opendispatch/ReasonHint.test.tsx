// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { Button, IconButton } from '@opendispatch/ui';
import { cleanup, fireEvent, renderHook, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { Reason, ReasonHint, useGate } from './ReasonHint';
import { hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReasonHint', () => {
  it('returns an available control untouched: no wrapper, no aria-disabled, and it acts', () => {
    const onClick = vi.fn();
    const { container } = inLocale(
      'en',
      <ReasonHint reason={null}>
        <Button onClick={onClick}>Publish</Button>
      </ReasonHint>,
    );
    const button = screen.getByRole('button', { name: 'Publish' });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(container.querySelector('[data-gated]')).toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    for (const none of [undefined, '']) {
      cleanup();
      inLocale(
        'en',
        <ReasonHint reason={none}>
          <Button>Publish</Button>
        </ReasonHint>,
      );
      expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('aria-disabled')).toBe(false);
    }
  });

  it('never runs the onClick of a gated control', () => {
    const onClick = vi.fn();
    inLocale(
      'en',
      <ReasonHint reason="View only for this role">
        <Button onClick={onClick}>Publish</Button>
      </ReasonHint>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('makes an unavailable control aria-disabled (still focusable, never disabled) and shows the reason next to it', () => {
    inLocale(
      'en',
      <ReasonHint reason="View only for this role">
        <Button variant="primary">Publish</Button>
      </ReasonHint>,
    );
    const button = screen.getByRole('button', { name: 'Publish' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('View only for this role')).toBeTruthy();
    // The visible line is also the control's description, so a screen reader hears it on focus.
    const line = screen.getByText('View only for this role').closest('span[id]');
    expect(line).not.toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe(line?.getAttribute('id'));
    // It can take keyboard focus, which a native disabled button cannot.
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('never acts: a click on an unavailable control does not reach its handler, and does not submit a form', () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    inLocale(
      'en',
      <form onSubmit={onSubmit}>
        <ReasonHint reason="Your role cannot approve this">
          <Button type="submit" onClick={onClick}>
            Approve
          </Button>
        </ReasonHint>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the reason as a tooltip when the control is tapped (a touch screen has no hover)', () => {
    inLocale(
      'en',
      <ReasonHint reason="Your role cannot approve this" visible={false}>
        <Button>Approve</Button>
      </ReasonHint>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('tooltip').textContent).toBe('Your role cannot approve this');
  });

  it('can leave out the visible line and keep the tooltip, or put the line under the control', () => {
    const quiet = inLocale(
      'en',
      <ReasonHint reason="Locked after approval" visible={false}>
        <Button>Edit</Button>
      </ReasonHint>,
    );
    expect(screen.queryByText('Locked after approval')).toBeNull();
    expect(quiet.container.querySelector('[data-gated]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' }).hasAttribute('aria-describedby')).toBe(false);
    cleanup();
    const below = inLocale(
      'en',
      <ReasonHint reason="Locked after approval" placement="below">
        <Button>Edit</Button>
      </ReasonHint>,
    );
    expect(screen.getByText('Locked after approval')).toBeTruthy();
    expect(below.container.querySelector('[data-gated]')?.className).toMatch(/below/);
  });

  it('keeps the description a control already has, and works on an icon button and a link', () => {
    inLocale(
      'en',
      <>
        <span id="other">Other help</span>
        <ReasonHint reason="Only an Administrator can reset" visible={false}>
          <IconButton icon={<i />} label="Reset password" aria-describedby="other" />
        </ReasonHint>
        <ReasonHint reason="Locked">
          <Button href="/somewhere">Open</Button>
        </ReasonHint>
      </>,
    );
    const reset = screen.getByRole('button', { name: 'Reset password' });
    expect(reset.getAttribute('aria-describedby')).toBe('other');
    expect(reset.getAttribute('aria-disabled')).toBe('true');
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link.getAttribute('aria-disabled')).toBe('true');
  });

  it('writes the reason in Arabic on an Arabic page, and every part of it', () => {
    const { container } = inLocale(
      'ar',
      <ReasonHint reason="عرض فقط لهذا الدور">
        <Button>نشر</Button>
      </ReasonHint>,
    );
    expect(screen.getByText('عرض فقط لهذا الدور')).toBeTruthy();
    expect(hasLatinLetters(readableText(container))).toBe(false);
  });

  it('hides its lock icon from assistive technology', () => {
    const { container } = inLocale(
      'en',
      <ReasonHint reason="Locked">
        <Button>Edit</Button>
      </ReasonHint>,
    );
    const icon = container.querySelector('[data-gated] svg');
    expect(icon).not.toBeNull();
    expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('Reason', () => {
  it('is only the visible line: an icon (hidden from assistive technology) and the text', () => {
    const { container } = inLocale('en', <Reason icon={<svg data-testid="icon" />}>Choose a reviewer</Reason>);
    expect(screen.getByText('Choose a reviewer')).toBeTruthy();
    expect(screen.getByTestId('icon').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('has no icon when none is given', () => {
    const { container } = inLocale('en', <Reason>Waiting for operator dispatch</Reason>);
    expect(container.querySelector('svg')).toBeNull();
  });
});

function gateHook(locale: 'en' | 'ar', access: Parameters<typeof useGate>[0]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      {children}
    </NextIntlClientProvider>
  );
  return renderHook(() => useGate(access), { wrapper }).result.current;
}

describe('useGate', () => {
  it('allows editing only with edit access, and says why not in English', () => {
    expect(gateHook('en', 'edit').edit).toEqual({ allowed: true, reason: null });
    expect(gateHook('en', 'view').edit).toEqual({ allowed: false, reason: 'View only for this role' });
    // Fails closed: no access is not a way to edit.
    expect(gateHook('en', 'none').edit).toEqual({ allowed: false, reason: 'View only for this role' });
  });

  it('takes the whole module access result as well as the access level', () => {
    expect(gateHook('en', { access: 'edit', reduced: false }).edit.allowed).toBe(true);
    expect(gateHook('en', { access: 'view', reduced: false }).edit.allowed).toBe(false);
    expect(gateHook('en', { access: 'edit', reduced: true }).edit.allowed).toBe(true);
  });

  it('gates approving on what the screen says the access model allows', () => {
    const gates = gateHook('en', 'edit');
    expect(gates.approve(true)).toEqual({ allowed: true, reason: null });
    expect(gates.approve(false)).toEqual({ allowed: false, reason: 'Your role cannot approve this' });
    // Edit access does not imply approving.
    expect(gateHook('en', 'view').approve(true).allowed).toBe(true);
  });

  it('answers in Arabic on an Arabic page', () => {
    const gates = gateHook('ar', 'view');
    expect(gates.edit.reason).toBe('عرض فقط لهذا الدور');
    expect(gates.approve(false).reason).toBe('دورك لا يتيح الاعتماد');
  });

  it('works with ReasonHint: a view-only person sees the reason, an editor gets the plain control', () => {
    function Screen({ access }: { access: 'edit' | 'view' }) {
      const gate = useGate(access);
      return (
        <ReasonHint reason={gate.edit.reason}>
          <Button variant="primary">Publish</Button>
        </ReasonHint>
      );
    }
    inLocale('en', <Screen access="view" />);
    expect(screen.getByRole('button', { name: 'Publish' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('View only for this role')).toBeTruthy();
    cleanup();
    inLocale('en', <Screen access="edit" />);
    expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText('View only for this role')).toBeNull();
  });
});
