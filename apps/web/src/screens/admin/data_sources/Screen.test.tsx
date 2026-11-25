// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { DataSourcesScreen } from './Screen';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// Only the ?state= review tests: they read no data
// (loadSourcesView needs live zones otherwise). The
// filled screen moved to Screen.live.test.tsx.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, saved: vi.fn(), navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.data_sources'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/data-sources', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ testFeed: vi.fn(), testAllFeeds: vi.fn(), switchFeed: vi.fn(), changeStage: vi.fn(), allToShadow: vi.fn(), saveFallback: vi.fn(), sendSignal: vi.fn(), setMaintenance: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

beforeEach(async () => {
  await resetGoTestState();
});
afterEach(() => {
  cleanup();
});

function ctxOf(role: Role = 'administrator', installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

interface Options {
  locale?: 'en' | 'ar';
  access?: 'edit' | 'view';
  search?: SearchParams;
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', access = 'edit', search = {}, state }: Options = {}) {
  env.locale = locale;
  env.query = new URLSearchParams(Object.entries(search).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : []))).toString();
  const element = await DataSourcesScreen({ def: getModule('admin.data_sources'), ctx: ctxOf(), access: { access, reduced: false }, locale, homeHref: '/admin/data-sources', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.data_sources' });
}

const disabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true';
const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const dataText = (container: HTMLElement) => {
  const copy = container.cloneNode(true) as HTMLElement;
  for (const node of copy.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
  return copy.textContent ?? '';
};

describe('Data Sources: the review states (?state=)', () => {
  it.each(['empty', 'loading', 'error'] as const)('?state=%s shows that state, keeps the header, and reads nothing', async (state) => {
    const { container } = await renderScreen({ state });
    expect(root(container)?.getAttribute('data-state')).toBe(state);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Data Sources and Integrations');
    if (state === 'empty') {
      expect(screen.getByText('No sources yet')).toBeTruthy();
      expect(screen.getByText('Connect the case feed first.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Connect a source' })).toBeTruthy();
      expect(container.querySelector('[data-stub="demo"]')).not.toBeNull();
    }
    if (state === 'error') {
      expect(screen.getByRole('alert').textContent).toContain('The feeds could not load.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    }
    if (state === 'loading') expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('a view-only role sees Connect a source disabled with its reason in the empty state', async () => {
    await renderScreen({ state: 'empty', access: 'view' });
    expect(disabled(screen.getByRole('button', { name: 'Connect a source' }))).toBe(true);
    expect(screen.getByText('View only for this role')).toBeTruthy();
  });
});

describe('Data Sources: Arabic states (?state=)', () => {
  it('draws the states in Arabic', async () => {
    for (const state of ['empty', 'error'] as const) {
      const { container } = await renderScreen({ locale: 'ar', state });
      expect(dataText(container)).not.toMatch(/[A-Za-z]{3}/);
      cleanup();
    }
  });
});
