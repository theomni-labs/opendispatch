// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale, readableText } from '../test-utils';
import { RecordDrawer, RecordNotice } from './RecordDrawer';

const url = vi.hoisted(() => ({ pathname: '/admin/users-roles', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => url.pathname, useRouter: () => url.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(url.query) }));

beforeEach(() => {
  url.query = 'tab=users&id=u1';
});
afterEach(() => {
  cleanup();
  url.router.replace.mockReset();
});

const drawer = (props: Partial<Parameters<typeof RecordDrawer>[0]> = {}) => (
  <RecordDrawer open recordKey="u1" title="Nadia" subtitle="nadia@example.test" footer={<button type="button">Disable user</button>} {...props}>
    <p>Body of the drawer</p>
  </RecordDrawer>
);

describe('RecordDrawer', () => {
  it('is a dialog named by its title, with the subtitle, the body and the footer, when the server says the record exists', () => {
    inLocale('en', drawer());
    const dialog = screen.getByRole('dialog', { name: 'Nadia' });
    expect(dialog.textContent).toContain('nadia@example.test');
    expect(dialog.textContent).toContain('Body of the drawer');
    expect(screen.getByRole('button', { name: 'Disable user' })).toBeTruthy();
  });

  it('is not there when the server says there is no such record', () => {
    inLocale('en', drawer({ open: false }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes at once and removes ?id= with a replace, keeping the tab and the page', () => {
    url.query = 'tab=users&page=2&id=u1';
    inLocale('en', drawer());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(url.router.replace).toHaveBeenCalledWith('/admin/users-roles?tab=users&page=2', { scroll: false });
  });

  it('closes on Escape too', () => {
    inLocale('en', drawer());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(url.router.replace).toHaveBeenCalledTimes(1);
  });

  it('removes the other parameters it was told to (an invite flag) and reports it', () => {
    url.query = 'new=1&tab=users';
    const onClosed = vi.fn();
    inLocale('en', drawer({ param: 'new', closeAlso: ['step'], onClosed }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(url.router.replace).toHaveBeenCalledWith('/admin/users-roles?tab=users', { scroll: false });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('stays closed while the server has not answered, and opens again for another record', () => {
    const { rerender } = inLocale('en', drawer());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    rerender(drawer()); // the server has not caught up: the same record is still "open"
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(drawer({ recordKey: 'u2', title: 'Fahad' }));
    expect(screen.getByRole('dialog', { name: 'Fahad' })).toBeTruthy();
  });

  it('opens the same record again after the server closed it', () => {
    const { rerender } = inLocale('en', drawer());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    rerender(drawer({ open: false }));
    rerender(drawer());
    expect(screen.getByRole('dialog', { name: 'Nadia' })).toBeTruthy();
  });

  it('returns focus to the control that had it when it opened', () => {
    const { rerender } = inLocale('en', <button type="button">row</button>);
    const row = screen.getByRole('button', { name: 'row' });
    row.focus();
    rerender(<><button type="button">row</button>{drawer()}</>);
    expect(document.activeElement).not.toBe(row);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(row);
  });

  it('reads right to left in Arabic with the close label from the messages', () => {
    inLocale('ar', drawer({ title: 'نادية', subtitle: 'nadia@example.test' }));
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeTruthy();
    expect(hasLatinLetters(readableText(screen.getByRole('dialog')), ['nadia@example.test', 'Disable user', 'Body of the drawer'])).toBe(false);
  });
});

describe('RecordNotice', () => {
  it('tells the person the record was not found and removes ?id= on dismiss (never a 500)', () => {
    url.query = 'tab=users&id=nonsense';
    inLocale('en', <RecordNotice />);
    expect(screen.getByRole('alert').textContent).toContain('That record could not be found.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(url.router.replace).toHaveBeenCalledWith('/admin/users-roles?tab=users', { scroll: false });
  });

  it('uses the module\'s own line and the Arabic one', () => {
    inLocale('en', <RecordNotice message="That user could not be found." />);
    expect(screen.getByText('That user could not be found.')).toBeTruthy();
    cleanup();
    inLocale('ar', <RecordNotice />);
    expect(screen.getByRole('alert').textContent).toContain('تعذّر العثور على هذا السجل.');
  });
});
