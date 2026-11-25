// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { createIdentityProvider } from '@/lib/data/identity';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { SignInIdentityScreen } from './Screen';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// loadIdentityView is api-backed: see
// Screen.live.test.tsx. States bypass it (state
// prop), so no live api needed here.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn(), download: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.sign_in_identity'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/sign-in-identity', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({
  saveProvider: vi.fn(),
  saveAndTestProvider: vi.fn(),
  testProvider: vi.fn(),
  setProviderEnabled: vi.fn(),
  removeProvider: vi.fn(),
  saveRule: vi.fn(),
  setRuleEnabled: vi.fn(),
  removeRule: vi.fn(),
  previewRules: vi.fn(),
  saveSignInPolicy: vi.fn(),
  setEmergencySignIn: vi.fn(),
  requestChange: vi.fn(),
}));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), downloadText: env.download }));

beforeEach(async () => {
  await resetGoTestState();
});
afterEach(() => {
  cleanup();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.navigate, env.download]) mock.mockReset();
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
  const element = await SignInIdentityScreen({ def: getModule('admin.sign_in_identity'), ctx: ctxOf('administrator', mode), access: { access, reduced: false }, locale, homeHref: '/admin/sign-in-identity', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.sign_in_identity' });
}

/** A provider of the Okta preset in the store, for the drawer and the wizard. */
async function addOkta(mode: InstallMode = 'private', enabled = true) {
  return await createIdentityProvider(ctxOf('administrator', mode), { preset_id: 'okta', display_name: 'Customer Okta', is_enabled: enabled, email_domains: ['acme.example'], config: { okta_domain: 'example.okta.com', client_id: 'opendispatch-test' }, client_secret: 'example-not-a-secret-value' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const isDisabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');

describe('Sign-in and Identity: the states', () => {
  it('empty: the module\'s own text and Add provider', async () => {
    const { container } = await renderScreen({ state: 'empty' });
    expect(root(container)?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('Add a provider so people can sign in with SSO.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add provider' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('empty for a view-only Administrator: the action is disabled with its reason next to it', async () => {
    await renderScreen({ state: 'empty', access: 'view', mode: 'shared' });
    expect(screen.getAllByRole('button', { name: 'Add provider' }).every(isDisabled)).toBe(true);
    expect(screen.getAllByText('Managed by our staff in the shared tier').length).toBeGreaterThan(0);
  });

  it('loading: skeletons, announced once, the header kept', async () => {
    const { container } = await renderScreen({ state: 'loading' });
    expect(root(container)?.getAttribute('data-state')).toBe('loading');
    expect(screen.getAllByText('Loading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign-in and Identity Providers');
  });

  it('error: "Providers could not load." as an alert with Try again', async () => {
    const { container } = await renderScreen({ state: 'error' });
    expect(root(container)?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('Providers could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a review state reads no data', async () => {
    await addOkta();
    await renderScreen({ state: 'empty' });
    expect(screen.queryByText('Customer Okta')).toBeNull();
  });
});
