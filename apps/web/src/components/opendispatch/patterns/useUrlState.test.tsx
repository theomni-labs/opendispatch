// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '../test-utils';
import { useUrlState } from './useUrlState';

const url = vi.hoisted(() => ({ pathname: '/admin/users-roles', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => url.pathname, useRouter: () => url.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(url.query) }));

beforeEach(() => {
  url.query = '';
});
afterEach(() => {
  cleanup();
  url.router.push.mockReset();
  url.router.replace.mockReset();
});

function Probe({ onState }: { onState?: (state: ReturnType<typeof useUrlState>) => void }) {
  const state = useUrlState();
  onState?.(state);
  return (
    <div>
      <span data-testid="tab">{state.get('tab') ?? 'none'}</span>
      <button type="button" onClick={() => state.update({ role: 'planner' })}>filter</button>
      <button type="button" onClick={() => state.update({ q: 'nour' })}>search</button>
      <button type="button" onClick={() => state.update({ id: 'u1' }, { history: 'push' })}>open</button>
      <button type="button" onClick={() => state.update({ id: null })}>close</button>
      <button type="button" onClick={() => state.update({ tab: 'roles', q: null })}>tab</button>
      <a href={state.hrefFor({ id: 'u2' })}>link</a>
    </div>
  );
}

describe('useUrlState', () => {
  it('reads the current value of a parameter, or undefined', () => {
    url.query = 'tab=roles';
    inLocale('en', <Probe />);
    expect(screen.getByTestId('tab').textContent).toBe('roles');
  });

  it('replaces the address (not pushes) for a filter, without scrolling, and keeps the other parameters', () => {
    url.query = 'tab=users&page=3';
    inLocale('en', <Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'filter' }));
    expect(url.router.replace).toHaveBeenCalledWith('/admin/users-roles?tab=users&role=planner', { scroll: false });
    expect(url.router.push).not.toHaveBeenCalled();
  });

  it('pushes when asked, so Back closes what opened, and a drawer keeps the page', () => {
    url.query = 'page=3';
    inLocale('en', <Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(url.router.push).toHaveBeenCalledWith('/admin/users-roles?page=3&id=u1');
    expect(url.router.replace).not.toHaveBeenCalled();
  });

  it('removes a parameter and goes to the bare path when nothing is left', () => {
    url.query = 'id=u1';
    inLocale('en', <Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(url.router.replace).toHaveBeenCalledWith('/admin/users-roles', { scroll: false });
  });

  it('lets updates made before the address has caught up build on each other', () => {
    inLocale('en', <Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    expect(url.router.replace).toHaveBeenLastCalledWith('/admin/users-roles?role=planner&q=nour', { scroll: false });
  });

  it('follows the real address when it changes (Back, another update)', () => {
    inLocale('en', <Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'filter' }));
    url.query = 'tab=roles';
    cleanup();
    inLocale('en', <Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    expect(url.router.replace).toHaveBeenLastCalledWith('/admin/users-roles?tab=roles&q=nour', { scroll: false });
  });

  it('builds the href of a link without navigating', () => {
    url.query = 'tab=users&q=x';
    inLocale('en', <Probe />);
    expect(screen.getByRole('link', { name: 'link' }).getAttribute('href')).toBe('/admin/users-roles?tab=users&q=x&id=u2');
    expect(url.router.replace).not.toHaveBeenCalled();
  });

  it('is pending while a transition runs and settles afterwards', async () => {
    const seen: boolean[] = [];
    inLocale('en', <Probe onState={(state) => seen.push(state.pending)} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'filter' }));
    });
    expect(seen.at(-1)).toBe(false);
  });
});
