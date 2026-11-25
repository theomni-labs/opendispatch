// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale, readableText } from '../test-utils';
import { ListToolbar, type ToolbarFilter } from './ListToolbar';
import { NoMatch } from './NoMatch';

const url = vi.hoisted(() => ({ pathname: '/admin/users-roles', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => url.pathname, useRouter: () => url.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(url.query) }));

beforeEach(() => {
  url.query = '';
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  url.router.replace.mockReset();
});

const filters: ToolbarFilter[] = [
  { key: 'role', label: 'Role', options: [{ value: 'planner', label: 'Planner' }, { value: 'dispatcher', label: 'Dispatcher' }] },
  { key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled' }] },
];
const box = () => screen.getByRole('searchbox') as HTMLInputElement;
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const replaced = () => url.router.replace.mock.calls.map((call) => call[0]);

describe('ListToolbar: search', () => {
  it('waits 300 ms after the last keystroke, then writes the trimmed text to q, once', () => {
    inLocale('en', <ListToolbar searchLabel="Search users" filters={filters} />);
    type('n');
    act(() => void vi.advanceTimersByTime(200));
    type('no');
    act(() => void vi.advanceTimersByTime(200));
    type('nour ');
    expect(replaced()).toEqual([]);
    act(() => void vi.advanceTimersByTime(299));
    expect(replaced()).toEqual([]);
    act(() => void vi.advanceTimersByTime(1));
    expect(replaced()).toEqual(['/admin/users-roles?q=nour']);
  });

  it('uses the given label as the placeholder and the accessible name, else "Search"', () => {
    inLocale('en', <ListToolbar searchLabel="Search users" />);
    expect(box().getAttribute('placeholder')).toBe('Search users');
    cleanup();
    inLocale('en', <ListToolbar />);
    expect(box().getAttribute('placeholder')).toBe('Search');
  });

  it('starts with the text in the address and follows the address when something else changes it (Clear all, Back)', () => {
    url.query = 'q=nour';
    const { rerender } = inLocale('en', <ListToolbar />);
    expect(box().value).toBe('nour');
    url.query = '';
    rerender(<ListToolbar />);
    expect(box().value).toBe('');
  });

  it('does not wipe letters typed while the server is still answering the last search', () => {
    const { rerender } = inLocale('en', <ListToolbar />);
    type('no');
    act(() => void vi.advanceTimersByTime(300));
    type('nou'); // typed while the address for 'no' has not come back
    url.query = 'q=no'; // the echo of what was sent arrives
    rerender(<ListToolbar />);
    expect(box().value).toBe('nou');
    act(() => void vi.advanceTimersByTime(300));
    expect(replaced().at(-1)).toBe('/admin/users-roles?q=nou');
  });

  it('removes q when the box is emptied', () => {
    url.query = 'q=nour&role=planner';
    inLocale('en', <ListToolbar filters={filters} />);
    type('');
    act(() => void vi.advanceTimersByTime(300));
    expect(replaced()).toEqual(['/admin/users-roles?role=planner']);
  });

  it('never sends a request for text that equals what is already in the address', () => {
    url.query = 'q=nour';
    inLocale('en', <ListToolbar />);
    type('nour ');
    act(() => void vi.advanceTimersByTime(600));
    expect(replaced()).toEqual([]);
  });

  it('can have no search box', () => {
    inLocale('en', <ListToolbar searchParam={false} filters={filters} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('button', { name: /Role/ })).toBeTruthy();
  });
});

describe('ListToolbar: filter chips', () => {
  it('writes the chosen option to the chip\'s own parameter, and sends the list to page 1', () => {
    url.query = 'page=2';
    inLocale('en', <ListToolbar filters={filters} />);
    fireEvent.click(screen.getByRole('button', { name: /Role/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Planner' }));
    expect(replaced()).toEqual(['/admin/users-roles?role=planner']);
  });

  it('shows an active filter as a removable chip and Clear all removes every filter but not the search', () => {
    url.query = 'q=nour&role=planner&status=active';
    inLocale('en', <ListToolbar filters={filters} />);
    expect(screen.getByText('Role: Planner')).toBeTruthy();
    expect(screen.getByText('Status: Active')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter Role: Planner' }));
    expect(replaced().at(-1)).toBe('/admin/users-roles?q=nour&status=active');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(replaced().at(-1)).toBe('/admin/users-roles?q=nour');
  });

  it('ignores a filter value that is not one of the options (no chip)', () => {
    url.query = 'role=root';
    inLocale('en', <ListToolbar filters={filters} />);
    expect(screen.queryByText(/Role: /)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('draws in Arabic with the labels the parent gives it and no English left over', () => {
    url.query = 'role=planner';
    const arFilters: ToolbarFilter[] = [{ key: 'role', label: 'الدور', options: [{ value: 'planner', label: 'مخطِّط' }] }];
    const { container } = inLocale('ar', <ListToolbar searchLabel="ابحث عن مستخدم" filters={arFilters} />);
    expect(hasLatinLetters(readableText(container))).toBe(false);
    expect(screen.getByText('الدور: مخطِّط')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'مسح الكل' })).toBeTruthy();
  });
});

describe('NoMatch', () => {
  it('says nothing matches and clears the search and every filter in one click', () => {
    url.query = 'q=zzz&role=planner&tab=users';
    inLocale('en', <NoMatch title="No users match" clearParams={['q', 'role', 'status']} />);
    expect(screen.getByText('No users match')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(replaced()).toEqual(['/admin/users-roles?tab=users']);
  });

  it('has a generic line in both languages', () => {
    inLocale('en', <NoMatch clearParams={['q']} />);
    expect(screen.getByText('Nothing matches')).toBeTruthy();
    cleanup();
    inLocale('ar', <NoMatch clearParams={['q']} />);
    expect(screen.getByText('لا توجد نتائج مطابقة')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'مسح الكل' })).toBeTruthy();
  });
});
