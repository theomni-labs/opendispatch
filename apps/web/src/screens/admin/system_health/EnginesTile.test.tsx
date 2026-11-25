// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import type { EngineStatuses } from '@/lib/types';
import { SystemHealthScreen } from './Screen';
import type { EnginesView } from './types';
import { enginesTile } from './view';

// The Engines tile in the services grid: status from the api, detail by mode, Unknown with no engine data; English and Arabic.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, engines: 'ok' as 'ok' | 'degraded', list: null as unknown, fail: false }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.system_health'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/system-health', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('./actions', () => ({ confirmBackupDone: vi.fn(), createDiagnostics: vi.fn() }));
vi.mock('@/lib/data/system', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/data/system')>();
  return {
    ...actual,
    getEngineStatuses: async () => {
      if (env.fail) throw new Error('down');
      return env.list;
    },
    getSystemHealth: async (...args: Parameters<typeof actual.getSystemHealth>) => {
      const health = await actual.getSystemHealth(...args);
      return { ...health, components: health.components.map((c) => (c.name === 'engines' ? { ...c, status: env.engines } : c)) };
    },
  };
});

const row = { calls: 0, failures: 0, timeouts: 0, breaker_opens: 0, rejected: 0, fallbacks: 0, model_version: null, last_failure_at: null } as const;
const NAMES = ['forecaster', 'optimizer', 'simulator', 'assignment'] as const;
const make = (modes: ('engine' | 'fixture')[], breaker: 'closed' | 'half_open' | 'open' = 'closed'): EngineStatuses => ({
  as_of: new Date().toISOString(),
  items: modes.map((mode, i) => ({ ...row, engine: NAMES[i] ?? 'forecaster', mode, breaker_state: mode === 'engine' ? breaker : 'closed' })),
});

beforeEach(async () => {
  await resetGoTestState();
  env.engines = 'ok';
  env.fail = false;
});
afterEach(() => {
  cleanup();
});

async function tile(locale: 'en' | 'ar'): Promise<HTMLElement> {
  env.locale = locale;
  const ctx = buildContext({ role: 'administrator', installMode: 'private', zoneIds: [] }, fixtureUsers(), fixtureTenantId());
  if (ctx === null) throw new Error('no context');
  const element = await SystemHealthScreen({ def: getModule('admin.system_health'), ctx, access: { access: 'edit', reduced: false }, locale, homeHref: '/', state: undefined, searchParams: {} });
  const { container } = inLocale(locale, <DesignSystemProvider navigate={vi.fn()}>{element}</DesignSystemProvider>, { module: 'admin.system_health' });
  return container.querySelector('[data-service="engines"]') as HTMLElement;
}

describe('enginesTile', () => {
  const ok = (modes: ('engine' | 'fixture')[]): EnginesView => ({
    status: 'ok',
    asOf: '',
    stale: false,
    rows: make(modes).items.map((i) => ({ engine: i.engine, mode: i.mode, breaker: i.breaker_state, calls: 0, failures: 0, timeouts: 0, rejected: 0, breakerOpens: 0, fixtureAnswers: 0, modelVersion: null, lastFailureAt: null })),
  });
  it('counts the engines on, and keeps the api status', () => {
    expect(enginesTile(ok(['engine', 'engine', 'engine', 'engine']), 'ok')).toEqual({ status: 'ok', detail: { kind: 'on', on: 4, total: 4 } });
    expect(enginesTile(ok(['engine', 'engine', 'fixture', 'fixture']), 'degraded')).toEqual({ status: 'degraded', detail: { kind: 'on', on: 2, total: 4 } });
    expect(enginesTile(ok(['fixture', 'fixture', 'fixture', 'fixture']), 'ok')).toEqual({ status: 'ok', detail: { kind: 'fixture' } });
  });
  it('is Unknown with no detail when the read failed, was not made or is empty', () => {
    expect(enginesTile({ status: 'error' }, 'ok')).toEqual({ status: 'unknown', detail: null });
    expect(enginesTile(undefined, 'ok')).toEqual({ status: 'unknown', detail: null });
    expect(enginesTile(ok([]), 'ok')).toEqual({ status: 'unknown', detail: null });
  });
});

describe('the Engines tile on the screen', () => {
  it('all four on: OK, 4 of 4 engines on', async () => {
    env.list = make(['engine', 'engine', 'engine', 'engine']);
    const t = await tile('en');
    expect(within(t).getByText('OK')).toBeTruthy();
    expect(within(t).getByText('4 of 4 engines on')).toBeTruthy();
  });
  it('all fixture: OK, Fixture models', async () => {
    env.list = make(['fixture', 'fixture', 'fixture', 'fixture']);
    const t = await tile('en');
    expect(within(t).getByText('OK')).toBeTruthy();
    expect(within(t).getByText('Fixture models')).toBeTruthy();
    expect(screen.queryByText('Placeholder models')).toBeNull();
  });
  it('mixed with a tripped breaker: Degraded, 2 of 4 engines on', async () => {
    env.list = make(['engine', 'engine', 'fixture', 'fixture'], 'half_open');
    env.engines = 'degraded';
    const t = await tile('en');
    expect(within(t).getByText('Degraded')).toBeTruthy();
    expect(within(t).getByText('2 of 4 engines on')).toBeTruthy();
  });
  it('read failed: Unknown with no detail', async () => {
    env.fail = true;
    const t = await tile('en');
    expect(within(t).getByText('Unknown')).toBeTruthy();
    expect(t.textContent).toBe('EnginesUnknown');
  });
  it('draws each variant in Arabic', async () => {
    env.list = make(['engine', 'engine', 'engine', 'engine']);
    expect(within(await tile('ar')).getByText('محرّكات مفعّلة: 4 من 4')).toBeTruthy();
    cleanup();
    env.list = make(['fixture', 'fixture', 'fixture', 'fixture']);
    expect(within(await tile('ar')).getByText('نماذج تجريبية')).toBeTruthy();
    cleanup();
    env.list = make(['engine', 'fixture', 'fixture', 'fixture'], 'open');
    env.engines = 'degraded';
    expect(within(await tile('ar')).getByText('محرّكات مفعّلة: 1 من 4')).toBeTruthy();
    cleanup();
    env.fail = true;
    expect((await tile('ar')).textContent).not.toMatch(/محرّكات مفعّلة|نماذج/);
  });
});
