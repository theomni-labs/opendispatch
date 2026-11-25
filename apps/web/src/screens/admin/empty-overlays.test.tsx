// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type ModuleId } from '@/lib/access';
import { buildContext, fixtureTenantId, fixtureUsers } from '@/lib/data/go-test-reset';
import { loadMessages } from '@/i18n/messages';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { ApiWebhooksScreen } from './api_webhooks/Screen';
import { ClassificationRulesScreen } from './classification_rules/Screen';
import { LeavePolicyCalendarScreen } from './leave_policy_calendar/Screen';
import { LocationsScreen } from './locations/Screen';
import { ShiftBreakPoliciesScreen } from './shift_break_policies/Screen';
import { SignInIdentityScreen } from './sign_in_identity/Screen';
import { AgentsVehiclesScreen } from './agents_vehicles/Screen';
import { UsersRolesScreen } from './users_roles/Screen';

// Real data, emptied: create drawers still open
const env = vi.hoisted(() => ({ module: '', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));

type View = Record<string, unknown>;
const { stub, emptied } = vi.hoisted(() => ({
  stub: async (load: () => Promise<View>) => Object.fromEntries(Object.keys(await load()).map((key) => [key, vi.fn()])),
  emptied: async (load: () => Promise<View>, name: string, empty: (view: View) => View) => {
    const mod = await load();
    const real = mod[name] as (...args: never[]) => Promise<View>;
    return { ...mod, [name]: async (...args: never[]) => empty(await real(...args)) };
  },
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator: create } = await import('next-intl');
  const { loadMessages: load } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => create({ locale: 'en', messages: load('en', env.module), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/x', useRouter: () => env.router, Link: (props: { children?: ReactNode }) => <a {...props} /> }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query), useRouter: () => env.router }));
vi.mock('@/lib/demo/actions', () => ({ setDemoSession: vi.fn(), signOutDemo: vi.fn() }));

vi.mock('./api_webhooks/actions', async (original) => stub(original));
vi.mock('./classification_rules/actions', async (original) => stub(original));
vi.mock('./leave_policy_calendar/actions', async (original) => stub(original));
vi.mock('./locations/actions', async (original) => stub(original));
vi.mock('./shift_break_policies/actions', async (original) => stub(original));
vi.mock('./sign_in_identity/actions', async (original) => stub(original));
vi.mock('./agents_vehicles/actions', async (original) => stub(original));
vi.mock('./users_roles/actions', async (original) => stub(original));

vi.mock('./api_webhooks/view', async (original) => emptied(original, 'loadApiView', (v) => ({ ...v, clients: [] })));
vi.mock('./classification_rules/view', async (original) => emptied(original, 'loadRulesView', (v) => ({ ...v, total: 0 })));
vi.mock('./leave_policy_calendar/view', async (original) => emptied(original, 'loadCalendarView', (v) => ({ ...v, holidays: [] })));
vi.mock('./locations/view', async (original) => emptied(original, 'loadLocationsView', (v) => ({ ...v, totals: { cities: 0, zones: 0, subZones: 0, standbyPoints: 0 } })));
vi.mock('./shift_break_policies/view', async (original) => emptied(original, 'loadShiftsView', (v) => ({ ...v, all: [] })));
vi.mock('./sign_in_identity/view', async (original) => emptied(original, 'loadIdentityView', (v) => ({ ...v, providers: [] })));
vi.mock('./agents_vehicles/view', async (original) => emptied(original, 'loadAgentsView', (v) => ({ ...v, totals: { ...(v['totals'] as object), agents: 0, vehicles: 0 } })));
vi.mock('./users_roles/view', async (original) => emptied(original, 'loadUsersView', (v) => ({ ...v, total: 0 })));

afterEach(() => {
  cleanup();
  for (const mock of Object.values(env.router)) mock.mockReset();
});

interface Case {
  module: ModuleId;
  Screen: (props: ScreenProps) => Promise<ReactNode>;
  /** The empty action's label key. */
  button: string;
  /** The parameter the empty action sets. */
  param: Record<string, string>;
}

const CASES: Case[] = [
  { module: 'admin.api_webhooks', Screen: ApiWebhooksScreen, button: 'create', param: { client: 'new' } },
  { module: 'admin.classification_rules', Screen: ClassificationRulesScreen, button: 'new', param: { rule: 'new' } },
  { module: 'admin.leave_policy_calendar', Screen: LeavePolicyCalendarScreen, button: 'add', param: { holiday: 'new' } },
  { module: 'admin.locations', Screen: LocationsScreen, button: 'import.label', param: { import: '1' } },
  { module: 'admin.shift_break_policies', Screen: ShiftBreakPoliciesScreen, button: 'add', param: { pattern: 'new' } },
  { module: 'admin.sign_in_identity', Screen: SignInIdentityScreen, button: 'add', param: { wizard: '1' } },
  { module: 'admin.agents_vehicles', Screen: AgentsVehiclesScreen, button: 'add.agent', param: { agent: 'new' } },
  { module: 'admin.users_roles', Screen: UsersRolesScreen, button: 'invite', param: { new: '1' } },
];

async function renderScreen({ module, Screen }: Case, search: SearchParams) {
  env.module = module;
  env.query = new URLSearchParams(search as Record<string, string>).toString();
  const ctx = buildContext({ role: 'administrator', installMode: 'private', zoneIds: [] }, fixtureUsers(), fixtureTenantId());
  if (ctx === null) throw new Error('no context');
  const element = await Screen({ def: getModule(module), ctx, access: { access: 'edit', reduced: false }, locale: 'en', homeHref: '/', state: undefined, searchParams: search });
  return inLocale('en', <DesignSystemProvider navigate={vi.fn()}>{element}</DesignSystemProvider>, { module });
}

const stateOf = (container: HTMLElement) => container.querySelector('[data-module]')?.getAttribute('data-state');

describe.each(CASES)('$module with no records', (entry) => {
  const translate = createTranslator({ locale: 'en', messages: loadMessages('en', entry.module), namespace: entry.module }) as unknown as (key: string) => string;
  const label = translate(entry.button);

  it('shows the empty state, and its action sets the create parameter', async () => {
    const { container } = await renderScreen(entry, {});
    expect(stateOf(container)).toBe('empty');
    expect(screen.queryByRole('dialog')).toBeNull();
    const empty = container.querySelector('[data-state="empty"] > :nth-child(2)') as HTMLElement;
    fireEvent.click(within(empty).getAllByRole('button', { name: label })[0] as HTMLElement);
    await waitFor(() => expect(env.router.push).toHaveBeenCalled());
    const href = String(env.router.push.mock.calls[0]?.[0]);
    for (const [key, value] of Object.entries(entry.param)) expect(new URLSearchParams(href.split('?')[1]).get(key)).toBe(value);
  });

  it('opens the create drawer from the empty state', async () => {
    const { container } = await renderScreen(entry, entry.param);
    expect(stateOf(container)).toBe('empty');
    expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0);
  });
});
