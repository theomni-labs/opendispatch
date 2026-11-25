// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { hasLatinLetters, inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { UsersRolesScreen } from './Screen';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// loadUsersView reads api-backed locations (Zones); the review
// states bypass it: see Screen.test.tsx.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the
// element it returns is rendered in each language. The data layer is real (fixtures, a temp demo store); the router, the
// actions, next-intl's server translator and the download are stood in for.
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
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
// A person's id, read from the address their row opens (the checkbox label carries the name, not the id).
const idOf = async (name: string) => {
  await renderScreen();
  const row = bodyRows().find((r) => r.textContent?.includes(name));
  if (row === undefined) throw new Error(`No row for ${name}`);
  fireEvent.click(row);
  const opened = env.navigate.mock.calls.at(-1)?.[0] as string | undefined;
  cleanup();
  env.navigate.mockClear();
  return new URL(opened ?? '', 'http://x').searchParams.get('id') ?? '';
};

describe.skipIf(!hasApi)('Users and Roles Screen (live, real api and Postgres)', () => {
  describe('Users and Roles: filled, English, Administrator (edit)', () => {
    it('carries the four hooks the e2e specs read, the module title, and the data source of the records', async () => {
      const { container } = await renderScreen();
      const page = root(container);
      expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.users_roles', 'filled', 'edit', 'false']);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Users and Roles');
      expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
      expect(screen.queryByText('View only')).toBeNull();
    });

    it('has at most two visible header actions: Invite user and More', async () => {
      await renderScreen();
      const invite = screen.getByRole('button', { name: 'Invite user' });
      expect(invite.hasAttribute('aria-disabled')).toBe(false);
      expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    });

    it('has the two tabs with their counts, and four summary figures', async () => {
      await renderScreen();
      const tabs = screen.getAllByRole('tab');
      expect(tabs.map((t) => t.textContent)).toEqual(['Users13', 'Roles7']);
      expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
      const stats = ['Users', 'Active', 'Invited', 'Disabled'].map((label) => screen.getAllByText(label).find((el) => el.closest('div')?.textContent?.match(/\d/)));
      expect(stats.every((el) => el !== undefined)).toBe(true);
      expect(screen.getByText('11')).toBeTruthy();
    });

    it('lists the 13 people with the six columns of the mockup, names and e-mails as data', async () => {
      const { container } = await renderScreen();
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Name', 'Email', 'Role', 'Scope', 'Status', 'Last sign-in']));
      expect(bodyRows()).toHaveLength(13);
      expect(container.querySelectorAll('td [translate="no"]').length).toBeGreaterThanOrEqual(26);
      expect(screen.getByText('Showing 13 of 13')).toBeTruthy();
    });

    it('draws the mockup\'s cells: zone tags with +N, role and scope in words, the emergency tag, statuses, the last sign-in', async () => {
      await renderScreen();
      const row = (name: string) => bodyRows().find((r) => r.textContent?.includes(name)) as HTMLElement;
      const fahad = row('Fahad Al-Musari');
      expect(within(fahad).getByText('Dispatch Supervisor')).toBeTruthy();
      expect(within(fahad).getByText('RD-C')).toBeTruthy();
      expect(within(fahad).getByText('RD-N')).toBeTruthy();
      expect(within(fahad).getByText('+3')).toBeTruthy();
      expect(within(row('Nadia Al-Ghalani')).getByText('Whole install')).toBeTruthy();
      expect(within(row('Maha Al-Khayani')).getByText('Remote pool')).toBeTruthy();
      expect(within(row('Emergency Administrator')).getByText('Emergency')).toBeTruthy();
      expect(within(row('Adel Al-Hinari')).getByText('Invited')).toBeTruthy();
      expect(within(row('Adel Al-Hinari')).getByText('Never')).toBeTruthy();
      expect(within(row('Ziyad Al-Khayani')).getByText('Disabled')).toBeTruthy();
      expect(within(row('Nadia Al-Ghalani')).getByText('Active')).toBeTruthy();
      expect(row('Nadia Al-Ghalani').textContent).toMatch(/12 Sept 2026 08:00/);
    });

    it('opens a person through ?id= when their row is pressed (rowHref, a push: Back closes the drawer)', async () => {
      const id = await idOf('Reem Al-Hinari');
      await renderScreen({ search: { q: 'reem' } });
      fireEvent.click(bodyRows()[0] as HTMLElement);
      expect(env.navigate).toHaveBeenCalledWith(`/admin/users-roles?q=reem&id=${id}`);
    });

    it('exports the rows on screen from the More menu, translated, and says so', async () => {
      await renderScreen({ search: { role: 'planner' } });
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export users' }));
      expect(env.saved).toHaveBeenCalledTimes(1);
      const [filename, table] = env.saved.mock.calls[0] as [string, { header: string[]; rows: string[][] }];
      expect(filename).toBe('users.csv');
      expect(table.header).toEqual(['Name', 'Email', 'Role', 'Scope', 'Status', 'Last sign-in']);
      expect(table.rows).toHaveLength(3);
      expect(table.rows.every((row) => row[2] === 'Planner')).toBe(true);
      expect(table.rows[0]).toEqual(['Reem Al-Hinari', 'reem.al.hinari@demo.example', 'Planner', 'RD-C RD-N RD-E', 'Active', '12 Sept 2026 09:30']);
      expect(await screen.findByText('Users exported')).toBeTruthy();
    });

    it('exports the selected rows from the bulk bar', async () => {
      await renderScreen();
      fireEvent.click(screen.getAllByRole('checkbox', { name: /Select row/ })[0] as HTMLElement);
      fireEvent.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Export' }));
      const [, table] = env.saved.mock.calls[0] as [string, { rows: string[][] }];
      expect(table.rows).toHaveLength(1);
    });
  });

  describe('Users and Roles: search and filters from the address (validated on the server)', () => {
    it('filters by ?q= and says how many', async () => {
      await renderScreen({ search: { q: 'nadia' } });
      expect(bodyRows()).toHaveLength(1);
      expect(screen.getByText('Showing 1 of 13')).toBeTruthy();
      expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('nadia');
    });

    it('filters by role, status and zone together and shows them as chips', async () => {
      await renderScreen({ search: { role: 'planner', status: 'invited', zone: 'RD-S' } });
      expect(bodyRows()).toHaveLength(1);
      expect(screen.getByText('Role: Planner')).toBeTruthy();
      expect(screen.getByText('Status: Invited')).toBeTruthy();
      expect(screen.getByText('Zone: RD-S')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Clear all' })).toBeTruthy();
    });

    it('ignores a value that is not on its allow-list: no filter, no chip, everyone is listed', async () => {
      await renderScreen({ search: { role: 'root', status: 'gone', zone: 'ZZ; DROP', page: '-3', tab: 'evil', q: '\u0000' } });
      expect(bodyRows()).toHaveLength(13);
      expect(screen.queryByText(/Role: /)).toBeNull();
      expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
    });

    it('shows "No users match" with Clear all when nothing matches, and the rest of the screen stays', async () => {
      await renderScreen({ search: { q: 'zzz-nobody' } });
      expect(screen.getByText('No users match')).toBeTruthy();
      fireEvent.click(screen.getAllByRole('button', { name: 'Clear all' }).at(-1) as HTMLElement);
      expect(env.router.replace).toHaveBeenCalledWith('/admin/users-roles', { scroll: false });
      expect(screen.getByText('Showing 0 of 13')).toBeTruthy();
    });

    it('offers Change Approver in the Role chip in a private install only', async () => {
      await renderScreen();
      fireEvent.click(screen.getByRole('button', { name: /Role/ }));
      expect(screen.getAllByRole('menuitemradio').map((o) => o.textContent)).toContain('Change Approver');
      cleanup();
      await renderScreen({ mode: 'shared' });
      fireEvent.click(screen.getByRole('button', { name: /Role/ }));
      expect(screen.getAllByRole('menuitemradio').map((o) => o.textContent)).not.toContain('Change Approver');
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Users13', 'Roles6']);
    });
  });

  describe('Users and Roles: the Roles tab', () => {
    it('shows the install mode toggle, the seven roles with counts, the effective access card and the matrix', async () => {
      const { container } = await renderScreen({ search: { tab: 'roles' } });
      expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('radiogroup', { name: 'Install mode' })).toBeTruthy();
      expect((screen.getByRole('radio', { name: 'Private' }) as HTMLInputElement | HTMLElement).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('heading', { name: 'Effective access' })).toBeTruthy();
      const matrix = container.querySelector('[data-matrix]') as HTMLElement;
      expect(matrix.querySelectorAll('thead th')).toHaveLength(8);
      expect(matrix.querySelectorAll('tbody tr')).toHaveLength(30 + 2);
      expect(screen.getByText('Access matrix')).toBeTruthy();
    });

    it('does not read the users list on this tab beyond the counts: no table of people', async () => {
      await renderScreen({ search: { tab: 'roles' } });
      expect(screen.queryByText('Showing 13 of 13')).toBeNull();
    });
  });

  describe('Users and Roles: the drawers from the address', () => {
    it('opens a person\'s drawer on first paint for ?id= with what they can do, and the switch, edit and disable actions', async () => {
      const id = await idOf('Reem Al-Hinari');
      await renderScreen({ search: { id } });
      const drawer = screen.getByRole('dialog', { name: 'Reem Al-Hinari' });
      expect(drawer.textContent).toContain('reem.al.hinari@demo.example');
      expect(drawer.textContent).toContain('Planner');
      expect(within(drawer).getByText('Can edit', { exact: false })).toBeTruthy();
      expect(within(drawer).getByRole('button', { name: 'Switch to this user' })).toBeTruthy();
      expect(within(drawer).getByRole('button', { name: 'Disable user' })).toBeTruthy();
      expect(within(drawer).getByRole('button', { name: 'Edit' })).toBeTruthy();
    });

    it('shows the emergency administrator\'s resets with the Demo tag', async () => {
      const id = await idOf('Emergency Administrator');
      await renderScreen({ search: { id } });
      const drawer = screen.getByRole('dialog', { name: 'Emergency Administrator' });
      expect(within(drawer).getByText('Emergency administrator')).toBeTruthy();
      expect(within(drawer).getByRole('button', { name: 'Reset password' })).toBeTruthy();
      expect(within(drawer).getByRole('button', { name: 'Reset MFA' })).toBeTruthy();
      expect(drawer.querySelectorAll('[data-stub="demo"]').length).toBeGreaterThanOrEqual(1);
    });

    it('shows Enable user for a disabled person and disables nothing else', async () => {
      const id = await idOf('Ziyad Al-Khayani');
      await renderScreen({ search: { id } });
      const drawer = screen.getByRole('dialog', { name: 'Ziyad Al-Khayani' });
      expect(within(drawer).getByRole('button', { name: 'Enable user' })).toBeTruthy();
      expect(within(drawer).getByRole('button', { name: 'Switch to this user' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('shows an inline notice and no drawer for an id that is malformed or names nobody', async () => {
      await renderScreen({ search: { id: 'nonsense' } });
      expect(screen.getByRole('alert').textContent).toContain('That user could not be found.');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(bodyRows()).toHaveLength(13);
      cleanup();
      await renderScreen({ search: { id: '00000000-0000-4000-8000-00000000dead' } });
      expect(screen.getByRole('alert').textContent).toContain('That user could not be found.');
    });

    it('opens the invite drawer on ?new=1 at step 1 with the stepper', async () => {
      await renderScreen({ search: { new: '1' } });
      const drawer = screen.getByRole('dialog', { name: 'Invite user' });
      expect(within(drawer).getByLabelText(/Full name/)).toBeTruthy();
      expect(within(drawer).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1Person', '2Role and zones', '3Review']);
    });
  });

  describe('Users and Roles: a role without edit access (view only)', () => {
    it('says View only, and shows every writing control disabled with the reason', async () => {
      await renderScreen({ access: 'view' });
      expect(screen.getByText('View only')).toBeTruthy();
      const invite = screen.getByRole('button', { name: 'Invite user' });
      expect(invite.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(invite);
      expect(env.router.push).not.toHaveBeenCalled();
      fireEvent.click(screen.getAllByRole('checkbox')[1] as HTMLElement);
      expect(screen.getByRole('button', { name: /Disable/ }).getAttribute('aria-disabled')).toBe('true');
    });

    it('keeps the drawer readable and its actions disabled, and does not open the invite drawer from ?new=1', async () => {
      const id = await idOf('Reem Al-Hinari');
      await renderScreen({ access: 'view', search: { id, new: '1' } });
      const drawer = screen.getByRole('dialog', { name: 'Reem Al-Hinari' });
      for (const name of ['Edit', 'Disable user']) expect(within(drawer).getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
      expect(screen.queryByRole('dialog', { name: 'Invite user' })).toBeNull();
    });

    it('shows the emergency resets disabled with "Only an Administrator can reset"', async () => {
      const id = await idOf('Emergency Administrator');
      await renderScreen({ access: 'view', search: { id } });
      const drawer = screen.getByRole('dialog', { name: 'Emergency Administrator' });
      expect(within(drawer).getByRole('button', { name: 'Reset password' }).getAttribute('aria-disabled')).toBe('true');
      expect(within(drawer).getByText('Only an Administrator can reset')).toBeTruthy();
    });
  });

  describe('Users and Roles in Arabic', () => {
    // Names, e-mails, zone codes and the server's English detail are data (translate="no" / lang="en"); everything else is Arabic.
    const untranslated = (container: HTMLElement) => {
      const clone = container.cloneNode(true) as HTMLElement;
      for (const node of clone.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
      const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].filter((el) => !/^(Select row|تحديد الصف)/.test(el.getAttribute('aria-label') ?? '')).flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
      return `${clone.textContent ?? ''} ${attributes.join(' ')}`;
    };

    it('draws the list in Arabic with no English left over outside the data', async () => {
      const { container } = await renderScreen({ locale: 'ar' });
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('المستخدمون والأدوار');
      expect(hasLatinLetters(untranslated(container), [])).toBe(false);
      expect(screen.getByRole('button', { name: 'دعوة مستخدم' })).toBeTruthy();
      expect(screen.getByText('عرض 13 من 13')).toBeTruthy();
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['المستخدمون13', 'الأدوار7']);
      expect(container.querySelector('[data-badge="SYNTHETIC"]')?.textContent).toBe('اصطناعية');
    });

    it('draws the roles tab, a person\'s drawer and the invite drawer in Arabic with no English left over', async () => {
      const roles = await renderScreen({ locale: 'ar', search: { tab: 'roles' } });
      expect(hasLatinLetters(untranslated(roles.container), [])).toBe(false);
      cleanup();
      const id = await idOf('Reem Al-Hinari');
      await renderScreen({ locale: 'ar', search: { id } });
      expect(hasLatinLetters(untranslated(screen.getByRole('dialog')), [])).toBe(false);
      cleanup();
      await renderScreen({ locale: 'ar', search: { new: '1' } });
      expect(hasLatinLetters(untranslated(screen.getByRole('dialog')), [])).toBe(false);
    });

    it('shows view-only in Arabic with the Arabic reason', async () => {
      await renderScreen({ locale: 'ar', access: 'view' });
      expect(screen.getByText('عرض فقط')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'دعوة مستخدم' }).getAttribute('aria-disabled')).toBe('true');
    });
  });
});
