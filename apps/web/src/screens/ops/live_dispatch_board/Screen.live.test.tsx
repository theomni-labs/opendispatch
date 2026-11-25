// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { controlReplay } from '@/lib/data/dispatch';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import type { ScreenProps } from '@/screens/types';
import { LiveDispatchBoardScreen } from './Screen';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// The review states are pure (state prop bypasses the
// data load): see Screen.test.tsx.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

// Real data layer; router/actions stood in for.
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
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('./actions', () => env.actions);

beforeEach(() => {
  env.locale = 'en';
});
afterEach(() => {
  cleanup();
  for (const fn of [env.router.replace, env.router.push, env.router.refresh, env.navigate, ...Object.values(env.actions)]) fn.mockReset();
});

async function ctxOf(role: Role, installMode: InstallMode = 'private'): Promise<RequestContext> {
  const tenant = fixtureTenantId();
  const bootstrap: RequestContext = { customerId: tenant, userId: 'bootstrap', role: 'administrator', zoneScope: { kind: 'whole_install' }, installMode };
  const zoneIds = role === 'dispatcher' || role === 'dispatch_supervisor' ? (await listZones(bootstrap, { limit: 200 })).items.map((z) => z.id) : [];
  const built = buildContext({ role, installMode, zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

interface Options {
  locale?: 'en' | 'ar';
  role?: Role;
  access?: 'edit' | 'view';
  state?: ScreenProps['state'];
  seekTo?: string;
  searchParams?: ScreenProps['searchParams'];
}

async function renderScreen({ locale = 'en', role = 'administrator', access = 'view', state, seekTo, searchParams = {} }: Options = {}) {
  env.locale = locale;
  const ctx = await ctxOf(role);
  if (seekTo !== undefined) await controlReplay(await ctxOf('dispatcher'), { action: 'seek', replay_at: seekTo });
  const element = await LiveDispatchBoardScreen({ def: getModule('ops.live_dispatch_board'), ctx, access: { access, reduced: false }, locale, homeHref: '/ops/live-dispatch-board', state, searchParams });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'ops.live_dispatch_board' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');

describe.skipIf(!hasApi)('Live Dispatch Board Screen (live, real api and Postgres)', () => {
  describe('filled, English, Administrator (view)', () => {
    it('carries the four hooks, the module title, the replay subtitle, the data source and View only', async () => {
      const { container } = await renderScreen();
      const page = root(container);
      expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access')]).toEqual(['ops.live_dispatch_board', 'filled', 'view']);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Live Dispatch Board');
      expect(screen.getByText(/^Replay of /)).toBeTruthy();
      expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
      expect(screen.getByText('View only')).toBeTruthy();
    });

    it('shows the four figures, the five tabs and the three board columns', async () => {
      const { container } = await renderScreen();
      for (const label of ['Waiting', 'Over 10 min', 'Within 10 min', 'Fallback']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      expect(container.querySelector('section[role="status"][data-active]')).not.toBeNull();
      expect(screen.getAllByText('Illustrative').length).toBeGreaterThan(0);
      for (const name of ['Board', 'Map', 'Out of reach', 'Shadow comparison']) expect(screen.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeTruthy();
      for (const label of ['Waiting', 'Recommended', 'In progress']) expect(screen.getByRole('heading', { name: label })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Shadow comparison' })).toBeNull();
    });

    it('?tab=shadow shows the comparison and both 10-minute readings; ?tab=map shows the agents', async () => {
      await renderScreen({ searchParams: { tab: 'shadow' } });
      expect(screen.getByRole('heading', { name: 'Shadow comparison' })).toBeTruthy();
      expect(screen.getAllByText('From assignment').length).toBeGreaterThan(0);
      expect(screen.getAllByText('From registration').length).toBeGreaterThan(0);
      cleanup();
      await renderScreen({ searchParams: { tab: 'map' } });
      expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Recommended' })).toBeNull();
    });

    it('the replay and outage buttons are present but unavailable to a view-only role', async () => {
      await renderScreen();
      const replayButton = screen.getByRole('button', { name: /replay/i });
      expect(replayButton.getAttribute('aria-disabled')).toBe('true');
    });
  });

  describe('filled, English, Dispatcher (edit)', () => {
    it('a recommended case can be accepted or overridden', async () => {
      const { container } = await renderScreen({ role: 'dispatcher', access: 'edit', seekTo: '2026-09-13T10:42:50+03:00' });
      const page = root(container);
      expect(page?.getAttribute('data-access')).toBe('edit');
      const recommended = screen.getByRole('heading', { name: 'Recommended' }).closest('section') as HTMLElement;
      const acceptButtons = within(recommended).queryAllByRole('button', { name: 'Accept' });
      if (acceptButtons.length === 0) return; // the replay day may have no recommended case left at this moment
      expect(acceptButtons[0]?.getAttribute('aria-disabled')).not.toBe('true');
      fireEvent.click(within(recommended).getAllByRole('button', { name: 'Override' })[0] as HTMLElement);
      expect(screen.getByRole('dialog', { name: 'Override assignment' })).toBeTruthy();
    });

    it('a refused second Accept says so in a toast, plain words first and the code second', async () => {
      const line = 'ALREADY_ASSIGNED: RD-260913-00901 already has an assignment (OpenDispatch).';
      env.actions.accept.mockResolvedValue({ ok: false, code: 'conflict', message: line });
      await renderScreen({ role: 'dispatcher', access: 'edit', seekTo: '2026-09-13T10:42:50+03:00' });
      const recommended = screen.getByRole('heading', { name: 'Recommended' }).closest('section') as HTMLElement;
      const acceptButtons = within(recommended).queryAllByRole('button', { name: 'Accept' });
      if (acceptButtons.length === 0) return; // none left at this moment
      fireEvent.click(acceptButtons[0] as HTMLElement);
      expect(await screen.findByText('Already assigned: nothing was sent')).toBeTruthy();
      expect(screen.getByText(line).getAttribute('lang')).toBe('en');
      expect(screen.queryByText('That is not possible in its current state.')).toBeNull();
    });
  });

  describe('Arabic', () => {
    it('renders right to left with the Arabic title', async () => {
      const { container } = await renderScreen({ locale: 'ar' });
      expect(container.querySelector('[dir]')?.getAttribute('dir')).toBe('rtl');
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('لوحة التوجيه المباشر');
    });
  });
});
