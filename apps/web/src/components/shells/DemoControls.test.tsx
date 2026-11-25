// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentPropsWithRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '@/components/opendispatch/Providers';
import { rolesForInstallMode } from '@/lib/access';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { DemoControls, type DemoOptionsView } from './DemoControls';

const actions = vi.hoisted(() => ({ setDemoSession: vi.fn(), signOutDemo: vi.fn() }));
vi.mock('@/lib/demo/actions', () => actions);
vi.mock('@/i18n/navigation', () => ({
  Link: (props: ComponentPropsWithRef<'a'>) => <a {...props} />,
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const options: DemoOptionsView = {
  customerName: 'Example Response (synthetic)',
  zones: [
    { id: 'z1', name: 'Riyadh Central', cityName: 'Riyadh' },
    { id: 'z2', name: 'Riyadh North', cityName: 'Riyadh' },
    { id: 'z3', name: 'Jeddah Central', cityName: 'Jeddah' },
  ],
  rolesByInstallMode: { private: rolesForInstallMode('private'), dedicated: rolesForInstallMode('dedicated'), shared: rolesForInstallMode('shared') },
};

afterEach(() => {
  cleanup();
  actions.setDemoSession.mockReset();
  actions.signOutDemo.mockReset();
});

function renderControls(locale: 'en' | 'ar', props: Partial<Parameters<typeof DemoControls>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <Providers locale={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <DemoControls variant="page" options={options} initial={{ installMode: 'private', role: 'dispatcher', zoneIds: ['z1', 'z2'] }} submitLabel="Go" {...props} />
      </Providers>
    </NextIntlClientProvider>,
  );
}

const radio = (value: string) => document.querySelector<HTMLInputElement>(`input[type=radio][value="${value}"]`);
const zones = () => screen.getAllByRole('checkbox') as HTMLInputElement[];

describe('DemoControls', () => {
  it('offers 7 roles in a private install and 6 (no Change Approver) in the others', () => {
    renderControls('en');
    expect(document.querySelectorAll('input[type=radio][name$="-role"]')).toHaveLength(7);
    expect(radio('change_approver')).not.toBeNull();
    fireEvent.click(radio('shared') as HTMLInputElement);
    expect(document.querySelectorAll('input[type=radio][name$="-role"]')).toHaveLength(6);
    expect(radio('change_approver')).toBeNull();
  });

  it('moves to the first role when the chosen install mode does not have the current role', () => {
    renderControls('en', { initial: { installMode: 'private', role: 'change_approver', zoneIds: [] } });
    expect(radio('change_approver')?.checked).toBe(true);
    fireEvent.click(radio('dedicated') as HTMLInputElement);
    expect(radio('administrator')?.checked).toBe(true);
  });

  it('enables the zones only for zone-scoped roles, keeping the ticks', () => {
    renderControls('en');
    expect(zones().map((zone) => zone.checked)).toEqual([true, true, false]);
    expect(zones().every((zone) => !zone.disabled)).toBe(true);

    fireEvent.click(radio('administrator') as HTMLInputElement);
    expect(zones().every((zone) => zone.disabled && !zone.checked)).toBe(true);
    fireEvent.click(radio('remote_team_lead') as HTMLInputElement);
    expect(zones()[0]?.disabled).toBe(true);

    fireEvent.click(radio('planner') as HTMLInputElement);
    expect(zones().map((zone) => zone.disabled)).toEqual([false, false, false]);
    expect(zones().map((zone) => zone.checked)).toEqual([true, true, false]);
  });

  it('sends only the switcher fields to the server action, and no zones for a whole-install role', async () => {
    actions.setDemoSession.mockResolvedValue(undefined);
    const onDone = vi.fn();
    renderControls('en', { onDone });
    fireEvent.click(zones()[2] as HTMLInputElement);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(actions.setDemoSession).toHaveBeenLastCalledWith({ role: 'dispatcher', installMode: 'private', zoneIds: ['z1', 'z2', 'z3'] }, 'en');

    fireEvent.click(radio('administrator') as HTMLInputElement);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(actions.setDemoSession).toHaveBeenCalledTimes(2));
    expect(actions.setDemoSession).toHaveBeenLastCalledWith({ role: 'administrator', installMode: 'private', zoneIds: [] }, 'en');
  });

  it('shows what the server refused and does not close', async () => {
    actions.setDemoSession.mockResolvedValue({ ok: false, error: 'unknown_zone' });
    const onDone = vi.fn();
    renderControls('en', { onDone });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Unknown zone.');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows Sign out only when asked, and calls the sign-out action', async () => {
    actions.signOutDemo.mockResolvedValue(undefined);
    renderControls('en');
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    cleanup();
    renderControls('ar', { showSignOut: true });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));
    await waitFor(() => expect(actions.signOutDemo).toHaveBeenCalledWith('ar'));
  });

  it('is in Arabic with the role and scope names from the messages', () => {
    renderControls('ar');
    expect(screen.getByText('مسؤول النظام')).toBeTruthy();
    expect(screen.getAllByText('كامل النظام').length).toBeGreaterThan(0);
    expect(screen.getByText('العميل')).toBeTruthy();
  });
});
