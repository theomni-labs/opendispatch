// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentPropsWithRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Providers } from '@/components/opendispatch/Providers';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { rolesForInstallMode } from '@/lib/access';
import type { DemoOptionsView } from './DemoControls';
import { ShellFrame, type ShellFrameProps } from './ShellFrame';
import { shellConsoles, shellSearchItems, type Translate } from './shell-model';

// next-intl's navigation helpers need Next's app router; the shell only needs their shape.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, locale, ...props }: ComponentPropsWithRef<'a'> & { locale?: string }) => <a {...props} href={typeof href === 'string' ? href : '/'} data-locale={locale} />,
  usePathname: () => '/ops/forecast-explorer',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('state=error') }));
vi.mock('@/lib/demo/actions', () => ({ setDemoSession: vi.fn(), signOutDemo: vi.fn() }));

type Tree = { [key: string]: string | Tree };
const translator =
  (messages: Tree): Translate =>
  (key) => {
    let node: string | Tree | undefined = messages;
    for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
    if (typeof node !== 'string') throw new Error(`No message ${key}`);
    return node;
  };
const tEn = translator(en as Tree);
const tAr = translator(ar as Tree);

const demoOptions: DemoOptionsView = {
  customerName: 'Example Response (synthetic)',
  zones: [
    { id: 'z1', name: 'Riyadh Central', cityName: 'Riyadh' },
    { id: 'z2', name: 'Riyadh North', cityName: 'Riyadh' },
  ],
  rolesByInstallMode: { private: rolesForInstallMode('private'), dedicated: rolesForInstallMode('dedicated'), shared: rolesForInstallMode('shared') },
};

beforeAll(() => {
  // RailShell listens to the desktop media query; jsdom has none.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
  // The palette scrolls the highlighted result into view; jsdom has no layout.
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(cleanup);

function frameProps(locale: 'en' | 'ar', role: 'administrator' | 'dispatcher', over: Partial<ShellFrameProps> = {}): ShellFrameProps {
  const t = locale === 'ar' ? tAr : tEn;
  const other = locale === 'ar' ? tEn : tAr;
  return {
    brand: { name: 'OPENDISPATCH', mark: 'AD' },
    currentConsole: { id: role === 'administrator' ? 'admin' : 'ops', label: t(`shell.console.${role === 'administrator' ? 'admin' : 'ops'}`) },
    consoles: shellConsoles(role, 'private', t),
    searchItems: shellSearchItems(role, 'private', t, [other]),
    searchLabel: t('shell.search'),
    viewOnlyLabel: t('shell.access.view'),
    demo: { options: demoOptions, current: { installMode: 'private', role, zoneIds: [] } },
    unreadCount: 0,
    notificationsHref: undefined,
    user: { label: t('demo.user'), initials: t('demo.userInitials') },
    children: <p>{locale === 'ar' ? 'صفحة' : 'page'}</p>,
    ...over,
  };
}

function renderFrame(locale: 'en' | 'ar', props: ShellFrameProps) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <Providers locale={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <ShellFrame {...props} />
      </Providers>
    </NextIntlClientProvider>,
  );
}

const groups = () => [...document.querySelectorAll('[data-shell="rail"] [data-shell-group]')].map((el) => el.getAttribute('data-shell-group'));

describe('ShellFrame', () => {
  it('draws one rail button per console the role can open, and marks the switch only when there are two', () => {
    const both = renderFrame('en', frameProps('en', 'administrator'));
    expect(groups()).toEqual(['ops', 'admin']);
    expect(both.container.querySelector('[data-console-switch]')?.getAttribute('data-console-switch')).toBe('ops admin');
    expect(both.container.querySelector('[data-console]')?.getAttribute('data-console')).toBe('admin');
    cleanup();

    const single = renderFrame('en', frameProps('en', 'dispatcher'));
    expect(groups()).toEqual(['ops']);
    expect(single.container.querySelector('[data-console-switch]')).toBeNull();
  });

  it('lists every module as a link in the console it belongs to, under the heading of its group, and marks view-only ones', () => {
    renderFrame('en', frameProps('en', 'administrator'));
    const ops = document.querySelector('[data-shell-group="ops"]') as HTMLElement;
    // The fly-out is closed, so its links are outside the accessibility tree until it opens: `hidden` finds them in the DOM.
    const board = within(ops).getByRole('link', { name: /Live Dispatch Board/, hidden: true });
    expect(board.getAttribute('href')).toBe('/ops/live-dispatch-board');
    expect(board.getAttribute('data-shell-item')).toBe('ops.live_dispatch_board');
    // The Administrator only views Ops: every Ops link carries the marker, spoken as "View only".
    expect(within(board).getByRole('img', { name: 'View only', hidden: true })).toBeTruthy();
    expect(within(ops).getByText('Live')).toBeTruthy();
    expect(within(ops).getByText('Analyze')).toBeTruthy();
    const admin = document.querySelector('[data-shell-group="admin"]') as HTMLElement;
    expect(within(within(admin).getByRole('link', { name: 'Users and Roles', hidden: true })).queryByRole('img', { hidden: true })).toBeNull();
  });

  it('names the rail buttons and the search in Arabic, with no English left over', () => {
    renderFrame('ar', frameProps('ar', 'administrator'));
    expect(screen.getByRole('button', { name: 'واجهة العمليات' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'واجهة الإدارة' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'التنقل الرئيسي' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'بحث في الأقسام' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'English' })).toBeTruthy();

    // Every text and every accessible name on the shell is Arabic; only the product name and the two language codes stay Latin.
    const strings = [document.body.textContent ?? '', ...[...document.querySelectorAll('[aria-label],[placeholder]')].flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('placeholder') ?? ''])];
    const latin = strings.join(' ').match(/[A-Za-z][A-Za-z'-]{2,}/g)?.filter((word) => !['OPENDISPATCH', 'English', 'ENAR'].includes(word)) ?? [];
    expect(latin).toEqual([]);
  });

  it('finds a module by its name in the other language', () => {
    renderFrame('ar', frameProps('ar', 'administrator'));
    const search = screen.getByRole('combobox', { name: 'بحث في الأقسام' });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'audit log' } });
    const results = screen.getAllByRole('option');
    expect(results.map((option) => option.textContent)).toContain('سجل التدقيقواجهة الإدارة');
    expect(results[0]?.getAttribute('href')).toBe('/admin/audit-log');
  });

  it('shows the bell as a link with the unread count for a role that has the inbox, and inert without a count otherwise', () => {
    renderFrame('en', frameProps('en', 'administrator', { unreadCount: 3, notificationsHref: '/admin/notifications-alerts' }));
    const bell = screen.getByRole('link', { name: 'Notifications: 3 unread' });
    expect(bell.getAttribute('href')).toBe('/admin/notifications-alerts');
    expect(bell.querySelector('[data-shell="bell-count"]')?.textContent).toBe('3');
    cleanup();

    renderFrame('en', frameProps('en', 'dispatcher'));
    // A role without the inbox gets a static image, not a focusable button that does nothing.
    expect(screen.queryByRole('button', { name: 'Notifications' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Notifications/ })).toBeNull();
    const inert = screen.getByRole('img', { name: 'Notifications' });
    expect(inert.getAttribute('tabindex')).toBeNull();
    expect(inert.querySelector('[data-shell="bell-count"]')).toBeNull();
  });

  it('has the Demo pill, the language toggle (path and query kept) and the initials at the end of the top bar', () => {
    renderFrame('en', frameProps('en', 'dispatcher'));
    const pill = document.querySelector('[data-demo-switcher="trigger"]') as HTMLElement;
    expect(pill.textContent).toBe('DemoDispatcher');
    const toggle = document.querySelector('[data-language-toggle]') as HTMLElement;
    expect(within(toggle).getByText('EN').getAttribute('aria-current')).toBe('true');
    expect(within(toggle).getByRole('link', { name: 'العربية' }).getAttribute('data-locale')).toBe('ar');
    expect(screen.getByRole('img', { name: 'Demo user' }).textContent).toBe('DU');
  });

  it('opens the Demo pop-over with the controls', () => {
    renderFrame('en', frameProps('en', 'dispatcher'));
    expect(document.querySelector('[data-demo-switcher="panel"]')).toBeNull();
    fireEvent.click(document.querySelector('[data-demo-switcher="trigger"]') as HTMLElement);
    const panel = document.querySelector('[data-demo-switcher="panel"]') as HTMLElement;
    expect(within(panel).getAllByRole('radio')).toHaveLength(3 + 7);
    expect(within(panel).getByRole('button', { name: 'Apply' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
