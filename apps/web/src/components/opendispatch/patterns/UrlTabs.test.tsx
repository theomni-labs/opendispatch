// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale, readableText } from '../test-utils';
import { TabPanel, UrlTabs } from './UrlTabs';

const url = vi.hoisted(() => ({ pathname: '/admin/users-roles', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => url.pathname, useRouter: () => url.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(url.query) }));

beforeEach(() => {
  url.query = '';
});
afterEach(() => {
  cleanup();
  url.router.replace.mockReset();
});

const tabs = [
  { value: 'users', label: 'Users', count: 13 },
  { value: 'roles', label: 'Roles', count: 7 },
];
const ui = <UrlTabs id="ur" ariaLabel="Sections" tabs={tabs} defaultTab="users" />;
const selected = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;

describe('UrlTabs', () => {
  it('shows the default tab when the address names none, and the named tab when it does', () => {
    inLocale('en', ui);
    expect(selected()).toContain('Users');
    cleanup();
    url.query = 'tab=roles';
    inLocale('en', ui);
    expect(selected()).toContain('Roles');
  });

  it('follows the tab the server rendered when it is given, even if the address hook lags', () => {
    url.query = '';
    const { rerender } = inLocale('en', <UrlTabs id="ur" ariaLabel="Sections" tabs={tabs} defaultTab="users" selected="roles" />);
    expect(selected()).toContain('Roles');
    fireEvent.click(screen.getByRole('tab', { name: /Users/ }));
    expect(selected()).toContain('Users');
    rerender(<UrlTabs id="ur" ariaLabel="Sections" tabs={tabs} defaultTab="users" selected="users" />);
    expect(selected()).toContain('Users');
  });

  it('shows the default tab for a value that is not a tab (the server ignores it as well)', () => {
    url.query = 'tab=settings';
    inLocale('en', ui);
    expect(selected()).toContain('Users');
  });

  it('writes the tab to the address and clears the other tab\'s search, sort and open record', () => {
    url.query = 'q=nour&sort=name%3Aasc&id=u1&role=planner';
    inLocale('en', ui);
    fireEvent.click(screen.getByRole('tab', { name: /Roles/ }));
    expect(url.router.replace).toHaveBeenCalledWith('/admin/users-roles?role=planner&tab=roles', { scroll: false });
  });

  it('leaves the parameter out for the default tab, so the plain address is the default view', () => {
    url.query = 'tab=roles';
    inLocale('en', ui);
    fireEvent.click(screen.getByRole('tab', { name: /Users/ }));
    expect(url.router.replace).toHaveBeenCalledWith('/admin/users-roles', { scroll: false });
  });

  it('shows counts and the names the parent gives it, in Arabic too', () => {
    inLocale('ar', <UrlTabs id="ur" ariaLabel="الأقسام" tabs={[{ value: 'users', label: 'المستخدمون', count: 13 }, { value: 'roles', label: 'الأدوار', count: 7 }]} defaultTab="users" />);
    expect(screen.getByRole('tablist', { name: 'الأقسام' })).toBeTruthy();
    expect(hasLatinLetters(readableText(screen.getByRole('tablist')))).toBe(false);
    expect(screen.getByRole('tab', { name: /الأدوار/ }).textContent).toContain('7');
  });
});

describe('TabPanel', () => {
  it('is a tabpanel named by its tab', () => {
    inLocale('en', <>{ui}<TabPanel id="ur" value="users">content</TabPanel></>);
    const panel = screen.getByRole('tabpanel');
    const tab = screen.getByRole('tab', { name: /Users/ });
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.getAttribute('id'));
    expect(panel.textContent).toBe('content');
  });
});
