// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { UsersRolesScreen } from './Screen';

// loadUsersView is api-backed: see Screen.live.test.tsx. The
// review states bypass it (an explicit state prop), so
// this file needs no live api.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, saved: vi.fn(), navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.users_roles'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/users-roles', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ inviteUser: vi.fn(), updateUserAccess: vi.fn(), disableUserAccount: vi.fn(), enableUserAccount: vi.fn(), disableUsers: vi.fn(), resetEmergencyPassword: vi.fn(), resetEmergencyMfa: vi.fn() }));
vi.mock('@/lib/demo/actions', () => ({ setDemoSession: vi.fn(), signOutDemo: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

beforeEach(async () => {
  await resetGoTestState();
});
afterEach(() => {
  cleanup();
  env.router.replace.mockReset();
  env.router.push.mockReset();
  env.saved.mockReset();
  env.navigate.mockReset();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

interface Options {
  locale?: 'en' | 'ar';
  access?: 'edit' | 'view';
  mode?: InstallMode;
  search?: SearchParams;
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', access = 'edit', mode = 'private', search = {}, state }: Options = {}) {
  env.locale = locale;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (typeof value === 'string') params.set(key, value);
  env.query = params.toString();
  const element = await UsersRolesScreen({ def: getModule('admin.users_roles'), ctx: ctxOf('administrator', mode), access: { access, reduced: false }, locale, homeHref: '/admin/users-roles', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.users_roles' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');

describe('Users and Roles: the five states', () => {
  it('empty: the module\'s own text and Invite user', async () => {
    const { container } = await renderScreen({ state: 'empty' });
    expect(root(container)?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('Invited users appear here.')).toBeTruthy();
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Invite user' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('empty for a view-only role: the action is there, disabled, with its reason next to it', async () => {
    await renderScreen({ state: 'empty', access: 'view' });
    const buttons = screen.getAllByRole('button', { name: 'Invite user' });
    expect(buttons.every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(screen.getAllByText('View only for this role').length).toBeGreaterThan(0);
  });

  it('loading: skeletons in a card, announced once, the header kept', async () => {
    const { container } = await renderScreen({ state: 'loading' });
    expect(root(container)?.getAttribute('data-state')).toBe('loading');
    expect(container.querySelector('[data-skeleton="list"]')).not.toBeNull();
    expect(screen.getAllByText('Loading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Users and Roles');
  });

  it('error: "Users could not load." as an alert with Try again', async () => {
    const { container } = await renderScreen({ state: 'error' });
    expect(root(container)?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('Users could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a review state reads no data: the same screen with the list of people never fetched', async () => {
    await renderScreen({ state: 'empty' });
    expect(screen.queryByText('Nadia Al-Ghalani')).toBeNull();
  });
});

describe('Users and Roles in Arabic', () => {
  it('draws the states in Arabic', async () => {
    await renderScreen({ locale: 'ar', state: 'empty' });
    expect(screen.getByText('يظهر المستخدمون المدعوون هنا.')).toBeTruthy();
    cleanup();
    await renderScreen({ locale: 'ar', state: 'error' });
    expect(screen.getByText('تعذّر تحميل المستخدمين.')).toBeTruthy();
  });
});
