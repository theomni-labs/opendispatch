// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import type { ScreenProps } from '@/screens/types';
import { LiveDispatchBoardScreen } from './Screen';

// loadLiveDispatchView is api-backed: see Screen.live.test.tsx.
// The review states bypass it (an explicit state prop),
// so this file needs no live api.
const env = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  navigate: vi.fn(),
  actions: { accept: vi.fn(), override: vi.fn(), toggleReplay: vi.fn(), toggleOutage: vi.fn() },
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'ops.live_dispatch_board'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/live-dispatch-board', useRouter: () => env.router }));
vi.mock('./actions', () => env.actions);

beforeEach(() => {
  env.locale = 'en';
});
afterEach(() => {
  cleanup();
  for (const fn of [env.router.replace, env.router.push, env.router.refresh, env.navigate, ...Object.values(env.actions)]) fn.mockReset();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

interface Options {
  locale?: 'en' | 'ar';
  role?: Role;
  access?: 'edit' | 'view';
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', role = 'administrator', access = 'view', state }: Options = {}) {
  env.locale = locale;
  const ctx = ctxOf(role);
  const element = await LiveDispatchBoardScreen({ def: getModule('ops.live_dispatch_board'), ctx, access: { access, reduced: false }, locale, homeHref: '/ops/live-dispatch-board', state, searchParams: {} });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'ops.live_dispatch_board' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');

describe('Live Dispatch Board: the review states', () => {
  it.each(['empty', 'loading', 'error', 'noaccess'] as const)('%s keeps the header and shows its text', async (state) => {
    const { container } = await renderScreen({ state });
    expect(root(container)?.getAttribute('data-state')).toBe(state);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Live Dispatch Board');
  });
});
