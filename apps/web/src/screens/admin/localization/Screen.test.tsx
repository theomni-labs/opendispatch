// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import type { ScreenProps } from '@/screens/types';
import * as actions from './actions';
import { LocalizationScreen } from './Screen';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// loadLocalizationView is api-backed: see Screen.live.test.tsx.
// The review states bypass it (an explicit state prop),
// so this file needs no live api.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.localization'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/localization', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('./actions', () => ({ saveLocalization: vi.fn(), resetLocalization: vi.fn() }));

const mocked = <K extends keyof typeof actions>(name: K) => actions[name] as unknown as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetGoTestState();
});
afterEach(() => {
  cleanup();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.navigate]) mock.mockReset();
  for (const name of Object.keys(actions) as (keyof typeof actions)[]) mocked(name).mockReset();
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
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', access = 'edit', mode = 'private', state }: Options = {}) {
  env.locale = locale;
  const element = await LocalizationScreen({ def: getModule('admin.localization'), ctx: ctxOf('administrator', mode), access: { access, reduced: false }, locale, homeHref: '/', state, searchParams: {} });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.localization' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const isDisabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
const save = () => screen.getByRole('button', { name: 'Save' });

describe('Localization: the states', () => {
  it('empty: "Defaults in use" with Configure, which goes back to the page', async () => {
    const { container } = await renderScreen({ state: 'empty' });
    expect(root(container)?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('Defaults in use')).toBeTruthy();
    expect(screen.getByText('English, Western digits, Riyadh time.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Configure' }).getAttribute('href')).toBe('/admin/localization');
    expect(isDisabled(save())).toBe(true);
  });

  it('loading: skeletons, announced once, the header kept', async () => {
    const { container } = await renderScreen({ state: 'loading' });
    expect(root(container)?.getAttribute('data-state')).toBe('loading');
    expect(screen.getAllByText('Loading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Localization');
  });

  it('error: "The settings could not load." as an alert with Try again', async () => {
    const { container } = await renderScreen({ state: 'error' });
    expect(root(container)?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('The settings could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a review state reads no data', async () => {
    await renderScreen({ state: 'error' });
    expect(screen.queryByText('Riyadh Central')).toBeNull();
  });
});

describe('Localization in Arabic', () => {
  it('draws the states in Arabic', async () => {
    await renderScreen({ locale: 'ar', state: 'empty' });
    expect(screen.getByText('الإعدادات الافتراضية قيد الاستخدام')).toBeTruthy();
    cleanup();
    await renderScreen({ locale: 'ar', state: 'error' });
    expect(screen.getByText('تعذّر تحميل الإعدادات.')).toBeTruthy();
  });
});
