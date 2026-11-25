// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignSystemProvider } from '../provider/provider';
import { NotificationsBell, RailShell, type NavGroup } from './rail-shell';

const groups: NavGroup[] = [
  {
    id: 'ops',
    label: 'Operations',
    items: [
      { id: 'ops.board', label: 'Board', href: '/ops/board', section: 'Live' },
      { id: 'ops.plan', label: 'Plan', href: '/ops/plan', section: 'Plan', icon: <span>*</span>, iconLabel: 'View only' },
    ],
  },
  { id: 'admin', label: 'Administration', items: [{ id: 'admin.users', label: 'Users', href: '/admin/users' }] },
];

const brand = { href: '/', label: 'Product', mark: 'P' };

afterEach(cleanup);

describe('RailShell', () => {
  it('has a skip link, a named navigation, one rail button per group and a main landmark', () => {
    render(
      <DesignSystemProvider activePath="/ops/plan">
        <RailShell groups={groups} brand={brand}>
          <p>Page</p>
        </RailShell>
      </DesignSystemProvider>,
    );
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe('#main-content');
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
    expect(screen.getByRole('main').textContent).toBe('Page');
    const ops = screen.getByRole('button', { name: 'Operations' });
    expect(ops.getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: 'Administration' }).getAttribute('data-active')).toBe('false');
    const plan = screen.getByRole('link', { name: /Plan/, hidden: true });
    expect(plan.getAttribute('aria-current')).toBe('page');
    expect(within(plan).getByRole('img', { name: 'View only', hidden: true })).toBeTruthy();
  });

  it('opens a fly-out on click and closes it with Escape, focus back on its button', () => {
    render(<RailShell groups={groups} brand={brand} />);
    const ops = screen.getByRole('button', { name: 'Operations' });
    fireEvent.click(ops);
    expect(ops.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: 'Operations' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(ops.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the navigation drawer from the menu button', () => {
    render(<RailShell groups={groups} brand={brand} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Product' });
    expect(within(drawer).getAllByRole('link').map((link) => link.getAttribute('data-shell-item'))).toEqual(['ops.board', 'ops.plan']);
    expect(within(drawer).getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

describe('NotificationsBell', () => {
  it('is a link with the count in its name, a button, or an inert image', () => {
    render(<NotificationsBell unreadCount={120} href="/inbox" />);
    const link = screen.getByRole('link', { name: 'Notifications: 120 unread' });
    expect(link.querySelector('[data-shell="bell-count"]')?.textContent).toBe('99+');
    cleanup();
    render(<NotificationsBell unreadCount={0} />);
    const inert = screen.getByRole('img', { name: 'Notifications' });
    expect(inert.getAttribute('tabindex')).toBeNull();
    expect(inert.querySelector('[data-shell="bell-count"]')).toBeNull();
  });
});
