// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModulePage } from '@/components/opendispatch/ModulePage';
import type { RequestContext } from '@/lib/data/guard';
import type { AdminScreen, ScreenProps } from '@/screens/types';
import { ModuleRoute } from './ModuleRoute';

// The route decides, on the server, who reaches a screen: unknown slug 404, no session the start page, no access the
// no-access page BEFORE any screen or data function runs, a registered Admin screen its screen, everything else the
// placeholder. Next's and next-intl's server pieces are stood in for; the route is called as a function and the element
// it returns is read.
const mocks = vi.hoisted(() => ({
  ctx: null as RequestContext | null,
  screens: {} as Record<string, unknown>,
  loaded: [] as string[],
}));

vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/i18n/navigation', () => ({
  redirect: ({ href }: { href: string }) => {
    throw new Error(`REDIRECT ${href}`);
  },
}));
vi.mock('@/lib/data/context', () => ({ getRequestContext: async () => mocks.ctx }));
vi.mock('@/screens/registry', () => ({
  loadAdminScreen: async (id: string) => {
    mocks.loaded.push(id);
    return mocks.screens[id];
  },
  loadOpsScreen: async (id: string) => {
    mocks.loaded.push(id);
    return mocks.screens[id];
  },
}));

const context = (role: RequestContext['role'], installMode: RequestContext['installMode'] = 'private'): RequestContext => ({
  customerId: '00000000-0000-4000-8000-000000000001',
  userId: 'user-1',
  role,
  zoneScope: { kind: 'whole_install' },
  installMode,
});

const Screen: AdminScreen = () => null;

const route = (console: 'ops' | 'admin', module: string, search: Record<string, string | string[] | undefined> = {}) =>
  ModuleRoute({ console, params: Promise.resolve({ locale: 'en', module }), searchParams: Promise.resolve(search) }) as Promise<ReactElement<Record<string, unknown>>>;

beforeEach(() => {
  mocks.ctx = context('administrator');
  mocks.screens = {};
  mocks.loaded = [];
});

describe('ModuleRoute', () => {
  it('answers 404 for a slug that is not a module of the console, without asking for a session', async () => {
    await expect(route('admin', 'nope')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(route('admin', 'live-dispatch-board')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(route('ops', 'users-roles')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sends a visitor with no session to the demo start page', async () => {
    mocks.ctx = null;
    await expect(route('admin', 'users-roles')).rejects.toThrow('REDIRECT /');
  });

  it('renders the registered screen of an Admin module with the context, access, locale and parsed state, built on the server', async () => {
    mocks.screens['admin.users_roles'] = Screen;
    const element = await route('admin', 'users-roles', { state: 'error', q: 'nour' });
    expect(element.type).toBe(Screen);
    const props = element.props as unknown as ScreenProps;
    expect(props.def.id).toBe('admin.users_roles');
    expect(props.ctx).toEqual(mocks.ctx);
    expect(props.access).toEqual({ access: 'edit', reduced: false });
    expect(props.locale).toBe('en');
    expect(props.state).toBe('error');
    expect(props.searchParams).toEqual({ state: 'error', q: 'nour' });
    expect(props.homeHref).toBe('/admin/users-roles');
  });

  it('gives a real screen no state unless the URL asks for one: the content is the default', async () => {
    mocks.screens['admin.users_roles'] = Screen;
    expect(((await route('admin', 'users-roles')).props as unknown as ScreenProps).state).toBeUndefined();
    expect(((await route('admin', 'users-roles', { state: 'filled' })).props as unknown as ScreenProps).state).toBeUndefined();
    expect(((await route('admin', 'users-roles', { state: ['loading', 'error'] })).props as unknown as ScreenProps).state).toBe('loading');
  });

  it('renders the placeholder for an Admin module with no screen yet, empty by default', async () => {
    const element = await route('admin', 'locations');
    expect(element.type).toBe(ModulePage);
    expect(element.props['state']).toBe('empty');
    expect(element.props['access']).toEqual({ access: 'edit', reduced: false });
    expect((await route('admin', 'locations', { state: 'loading' })).props['state']).toBe('loading');
    expect(mocks.loaded).toEqual(['admin.locations', 'admin.locations']);
  });

  it('renders the registered screen of an Ops module too, with the same context, access, locale and parsed state', async () => {
    mocks.screens['ops.forecast_explorer'] = Screen;
    const element = await route('ops', 'forecast-explorer', { state: 'error' });
    expect(element.type).toBe(Screen);
    const props = element.props as unknown as ScreenProps;
    expect(props.def.id).toBe('ops.forecast_explorer');
    expect(props.state).toBe('error');
    expect(mocks.loaded).toEqual(['ops.forecast_explorer']);
  });

  it('renders the placeholder for an Ops module with no registered screen yet', async () => {
    const element = await route('ops', 'forecast-explorer', { state: 'error' });
    expect(element.type).toBe(ModulePage);
    expect(element.props['state']).toBe('error');
    expect(mocks.loaded).toEqual(['ops.forecast_explorer']);
  });

  it('shows no access, and runs no screen, when the access model closes the module: whatever ?state= says', async () => {
    mocks.ctx = context('dispatcher');
    mocks.screens['admin.users_roles'] = Screen;
    for (const state of [undefined, 'empty', 'error', 'loading']) {
      const element = await route('admin', 'users-roles', state === undefined ? {} : { state });
      expect(element.type).toBe(ModulePage);
      expect(element.props['state']).toBe('noaccess');
      expect(element.props['access']).toEqual({ access: 'none', reduced: false });
      expect(element.props['homeHref']).toBe('/ops/live-dispatch-board');
    }
    expect(mocks.loaded).toEqual([]); // the screen was not even loaded, so no data function could run
  });

  it('runs no screen for a role that is not in the install mode (Change Approver outside a private install)', async () => {
    mocks.ctx = context('change_approver', 'shared');
    mocks.screens['admin.updates'] = Screen;
    const element = await route('admin', 'updates');
    expect(element.props['state']).toBe('noaccess');
    expect(mocks.loaded).toEqual([]);
  });

  it('passes the reduced access of the Administrator’s Updates in a shared install through to the screen', async () => {
    mocks.ctx = context('administrator', 'shared');
    mocks.screens['admin.updates'] = Screen;
    const props = (await route('admin', 'updates')).props as unknown as ScreenProps;
    expect(props.access).toEqual({ access: 'view', reduced: true });
  });
});
