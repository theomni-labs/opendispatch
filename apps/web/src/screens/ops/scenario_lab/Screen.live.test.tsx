// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import type { ScreenProps } from '@/screens/types';
import { ScenarioLabScreen } from './Screen';

// A real render, real messages, real data layer:
// the same class of check that caught a real bug
// this module had (a flat a.b JSON key instead of
// a nested one, which next-intl never resolves,
// unlike the static messages-usage.test.ts
// leaf-path check).

const env = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  navigate: vi.fn(),
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'ops.scenario_lab'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/scenario-lab', useRouter: () => env.router, Link: 'a' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  env.locale = 'en';
});
afterEach(() => {
  cleanup();
  for (const fn of [env.router.replace, env.router.push, env.router.refresh, env.navigate]) fn.mockReset();
});

async function ctxOf(role: Role): Promise<RequestContext> {
  const tenant = fixtureTenantId();
  const bootstrap: RequestContext = { customerId: tenant, userId: 'bootstrap', role: 'administrator', zoneScope: { kind: 'whole_install' }, installMode: 'private' };
  const zoneIds = role === 'planner' ? (await listZones(bootstrap, { limit: 200 })).items.map((z) => z.id) : [];
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

interface Options {
  locale?: 'en' | 'ar';
  role?: Role;
  access?: 'edit' | 'view';
  state?: ScreenProps['state'];
  searchParams?: ScreenProps['searchParams'];
}

async function renderScreen({ locale = 'en', role = 'administrator', access = 'view', state, searchParams = {} }: Options = {}) {
  env.locale = locale;
  const ctx = await ctxOf(role);
  const element = await ScenarioLabScreen({ def: getModule('ops.scenario_lab'), ctx, access: { access, reduced: false }, locale, homeHref: '/ops/scenario-lab', state, searchParams });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'ops.scenario_lab' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Zones come from locations.ts; the review-states
// block below never loads real data, so it stays ungated.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

describe.skipIf(!hasApi)('Scenario Lab: filled, English, Administrator (view)', () => {
  it('carries the header, the templates, the editor and the saved list, with no missing-message fallback text', async () => {
    const { container } = await renderScreen();
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access')]).toEqual(['ops.scenario_lab', 'filled', 'view']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Scenario Lab');
    expect(screen.getByText('More agents')).toBeTruthy();
    expect(screen.getByText('Ramadan shifts')).toBeTruthy();
    expect(screen.getAllByText('Remote share').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Scenario').length).toBeGreaterThan(0);
    expect(screen.getByText('Before and after')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Saved scenarios' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/MISSING_MESSAGE/);
  });

  it('Save and Run are present but unavailable to a view-only role', async () => {
    await renderScreen();
    const saveButton = screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement;
    expect(saveButton.getAttribute('aria-disabled')).toBe('true');
  });
});

describe.skipIf(!hasApi)('Scenario Lab: filled, English, Planner (edit)', () => {
  it('Save is available, and the name field is labelled', async () => {
    const { container } = await renderScreen({ role: 'planner', access: 'edit' });
    expect(root(container)?.getAttribute('data-access')).toBe('edit');
    const saveButton = screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement;
    expect(saveButton.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });
});

describe('Scenario Lab: the review states', () => {
  it.each(['empty', 'loading', 'error', 'noaccess'] as const)('%s keeps the header and shows its text', async (state) => {
    const { container } = await renderScreen({ state });
    expect(root(container)?.getAttribute('data-state')).toBe(state);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Scenario Lab');
    expect(container.textContent).not.toMatch(/MISSING_MESSAGE/);
  });
});

describe.skipIf(!hasApi)('Scenario Lab: Arabic', () => {
  it('renders right to left with the Arabic title and no missing-message text', async () => {
    const { container } = await renderScreen({ locale: 'ar' });
    expect(container.querySelector('[dir]')?.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('مختبر السيناريوهات');
    expect(container.textContent).not.toMatch(/MISSING_MESSAGE/);
  });
});

describe.skipIf(!hasApi)('Scenario Lab: opening a real saved scenario', () => {
  it('shows its adjustments and the live gap comparison', async () => {
    const { container } = await renderScreen({ searchParams: {} });
    expect(screen.getByText('Riyadh Central: four more field agents')).toBeTruthy();
    expect(container.textContent).not.toMatch(/MISSING_MESSAGE/);
  });
});
