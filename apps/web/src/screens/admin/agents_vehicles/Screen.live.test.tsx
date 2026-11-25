// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { addSkill, listAgents, listVehicles, removeSkill } from '@/lib/data/people';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { AgentsVehiclesScreen } from './Screen';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// The screen as the module route renders it: real Postgres, a temp demo store for audit/settings.
// The router, the actions, next-intl's server translator and the download are stood in for.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
// N+1 skills fetch, several renders per test.
vi.setConfig({ testTimeout: 180_000 });
const env = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  query: '',
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  saved: vi.fn(),
  navigate: vi.fn(),
  actions: { saveAgent: vi.fn(), setAgentsInactive: vi.fn(), saveVehicle: vi.fn(), addSkillToVocabulary: vi.fn(), renameSkill: vi.fn(), removeSkillFromVocabulary: vi.fn(), importAgentsCsv: vi.fn() },
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.agents_vehicles'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/agents-vehicles', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => env.actions);
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

afterEach(() => {
  cleanup();
  for (const fn of [env.router.replace, env.router.push, env.saved, env.navigate, ...Object.values(env.actions)]) fn.mockReset();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');

interface Options {
  locale?: 'en' | 'ar';
  access?: 'edit' | 'view';
  search?: SearchParams;
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', access = 'edit', search = {}, state }: Options = {}) {
  env.locale = locale;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (typeof value === 'string') params.set(key, value);
  env.query = params.toString();
  const element = await AgentsVehiclesScreen({ def: getModule('admin.agents_vehicles'), ctx: admin(), access: { access, reduced: false }, locale, homeHref: '/admin/agents-vehicles', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.agents_vehicles' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);
const talal = async () => (await listAgents(admin(), { q: 'SVR-RD-C-001', limit: 5 })).items[0]!;
/** Postgres is shared with other live test files: totals are read fresh, never hardcoded. */
const liveTotals = async () => {
  const ctx = admin();
  const [all, field, remote, allVehicles] = await Promise.all([listAgents(ctx, { limit: 1 }), listAgents(ctx, { kind: 'field', limit: 1 }), listAgents(ctx, { kind: 'remote', limit: 1 }), listVehicles(ctx, { limit: 1 })]);
  return { agents: all.page.total ?? 0, field: field.page.total ?? 0, remote: remote.page.total ?? 0, vehicles: allVehicles.page.total ?? 0 };
};

describe.skipIf(!hasApi)('Agents and Vehicles Screen (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

  describe('filled, English, Administrator (edit)', () => {
    it('carries the four hooks the e2e specs read, the module title, the data source, and two header actions', async () => {
      const { container } = await renderScreen();
      const page = root(container);
      expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.agents_vehicles', 'filled', 'edit', 'false']);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Agents and Vehicles');
      expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Add agent' }));
      expect(env.router.push).toHaveBeenCalledWith('/admin/agents-vehicles?agent=new');
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Import', 'Export']);
    });

    it('has the three tabs with counts, four figures (the handling ones marked inferred), and the seven columns of the mockup', async () => {
      const totals = await liveTotals();
      const { container } = await renderScreen();
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([`Agents${totals.agents}`, `Vehicles${totals.vehicles}`, 'Skills10']);
      expect([...container.querySelectorAll('[translate="no"]')].map((el) => el.textContent).slice(0, 8)).toEqual(expect.arrayContaining([String(totals.agents), String(totals.field), String(totals.remote), String(totals.vehicles)]));
      expect(screen.getAllByText('inferred').length).toBeGreaterThanOrEqual(2);
      expect(headers()).toEqual(expect.arrayContaining(['Name', 'Zone or pool', 'Shift', 'Skills', 'Vehicle', 'Status', 'Leave']));
      expect(bodyRows()).toHaveLength(25);
      expect(screen.getByText(`${totals.agents} of ${totals.agents}`)).toBeTruthy();
    });

    it('draws an agent row: name and code, zone tag, shift name, skills with +N, status', async () => {
      await renderScreen({ search: { q: 'SVR-RD-C-001' } });
      const row = bodyRows()[0] as HTMLElement;
      expect(within(row).getByText('Talal Al-Barahi')).toBeTruthy();
      expect(within(row).getByText('SVR-RD-C-001')).toBeTruthy();
      expect(within(row).getByText('RD-C')).toBeTruthy();
      expect(within(row).getByText('Day A')).toBeTruthy();
      expect(within(row).getByText('Active')).toBeTruthy();
    });

    it('filters by zone, the remote pool, shift and leave from the address, and shows the chips', async () => {
      const totals = await liveTotals();
      await renderScreen({ search: { zone: 'remote' } });
      expect(screen.getByText(`${totals.remote} of ${totals.agents}`)).toBeTruthy();
      expect(screen.getByText('Zone: Remote pool')).toBeTruthy();
      cleanup();
      await renderScreen({ search: { leave: 'requested', shift: 'day_a' } });
      expect(screen.getByText('Leave: Requested')).toBeTruthy();
      expect(screen.getByText('Shift: Day A')).toBeTruthy();
    });

    it('ignores a value that is not on its allow-list', async () => {
      const totals = await liveTotals();
      await renderScreen({ search: { zone: 'NOPE;', leave: 'root', tab: 'evil', agent: 'zzz', page: '-2', q: '\u0000' } });
      expect(screen.getByText(`${totals.agents} of ${totals.agents}`)).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('opens an agent through ?agent= when a row is pressed, and exports the selected rows and sets them inactive from the bulk bar', async () => {
      const t = await talal();
      await renderScreen({ search: { q: 'SVR-RD-C-001' } });
      fireEvent.click(bodyRows()[0] as HTMLElement);
      expect(env.navigate).toHaveBeenCalledWith(`/admin/agents-vehicles?q=SVR-RD-C-001&agent=${t.id}`);
      fireEvent.click(screen.getAllByRole('checkbox', { name: /Select row/ })[0] as HTMLElement);
      env.actions.setAgentsInactive.mockResolvedValue({ ok: true, data: { changed: 1, failed: 0 } });
      await act(async () => {
        fireEvent.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Set inactive' }));
      });
      expect(env.actions.setAgentsInactive).toHaveBeenCalledWith({ targetIds: [t.id] });
      expect(await screen.findByText('1 set inactive')).toBeTruthy();
    });
  });

  describe('the other tabs', () => {
    it('lists vehicles with plate, type, zone, who has it and status; Add becomes Add vehicle', async () => {
      await renderScreen({ search: { tab: 'vehicles', zone: 'RD-C' } });
      expect(headers()).toEqual(expect.arrayContaining(['Vehicle', 'Type', 'Zone', 'Assigned today', 'Status']));
      const first = bodyRows()[0] as HTMLElement;
      expect(within(first).getByText('VEH-RD-C-01')).toBeTruthy();
      expect(within(first).getByText('Sedan')).toBeTruthy();
      expect(within(first).getByText('In service')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Add vehicle' })).toBeTruthy();
      fireEvent.click(first);
      const firstVehicle = (await listVehicles(admin(), { limit: 1 })).items[0]?.id;
      expect(env.navigate).toHaveBeenCalledWith(`/admin/agents-vehicles?tab=vehicles&zone=RD-C&vehicle=${firstVehicle}`);
    });

    it('shows the skill vocabulary with how many agents hold each, and Add skill', async () => {
      await renderScreen({ search: { tab: 'skills' } });
      expect(screen.getByRole('heading', { name: 'Vocabulary' })).toBeTruthy();
      const chips = screen.getAllByRole('button').filter((b) => b.hasAttribute('data-skill'));
      expect(chips).toHaveLength(10);
      const first = chips.find((b) => b.getAttribute('aria-pressed') === 'true') as HTMLElement;
      expect(screen.getByRole('heading', { level: 2, name: first.textContent?.replace(/\d+$/, '') })).toBeTruthy();
      expect(screen.queryAllByText('English shown')).toHaveLength(0); // every skill has a draft Arabic name
      const injury = chips.find((b) => b.getAttribute('data-skill') === 'injury_protocol') as HTMLElement;
      fireEvent.click(injury);
      expect(injury.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('heading', { level: 2, name: 'Injury protocol' })).toBeTruthy();
      expect(screen.getByText(/In use by \d+ agents/)).toBeTruthy();
      const remove = screen.getByRole('button', { name: 'Remove skill' });
      expect(remove.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(remove);
      expect(env.actions.removeSkillFromVocabulary).not.toHaveBeenCalled();
      fireEvent.click(screen.getAllByRole('button', { name: 'Add skill' })[0] as HTMLElement);
      expect(env.router.push).toHaveBeenCalledWith('/admin/agents-vehicles?tab=skills&skill=new');
    });

    it('adds an Arabic name to a skill that has none, and removes a skill no agent holds', async () => {
      const ctx = admin();
      await addSkill(ctx, { code: 'screen_temp_skill', name_en: 'Screen temp skill' });
      try {
        env.actions.renameSkill.mockResolvedValue({ ok: true, data: { code: 'screen_temp_skill' } });
        env.actions.removeSkillFromVocabulary.mockResolvedValue({ ok: true, data: { code: 'screen_temp_skill' } });
        await renderScreen({ search: { tab: 'skills' } });
        fireEvent.click(screen.getByRole('button', { name: /Screen temp skill/ }));
        expect(screen.getByText('English shown')).toBeTruthy();
        expect(screen.queryByText(/In use by/)).toBeNull();
        fireEvent.change(screen.getByLabelText('Arabic name'), { target: { value: 'مهارة مؤقتة' } });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Add Arabic name' }));
        });
        expect(env.actions.renameSkill).toHaveBeenCalledWith({ code: 'screen_temp_skill', name_ar: 'مهارة مؤقتة' });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Remove skill' }));
        });
        expect(env.actions.removeSkillFromVocabulary).toHaveBeenCalledWith({ code: 'screen_temp_skill' });
      } finally {
        await removeSkill(ctx, 'screen_temp_skill');
      }
    });
  });

  describe('the drawers from the address', () => {
    it('opens an agent on first paint with name, zone, shift, skills, days off, handling marked inferred, and Save', async () => {
      await renderScreen({ search: { agent: (await talal()).id } });
      const drawer = screen.getByRole('dialog', { name: 'Edit agent' });
      expect((within(drawer).getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Talal Al-Barahi');
      expect((within(drawer).getByLabelText('Home shift') as HTMLSelectElement).value).toBe('day_a');
      expect(within(drawer).getByRole('checkbox', { name: 'Sun' })).toHaveProperty('checked', true);
      expect(within(drawer).getByRole('checkbox', { name: 'Wed' })).toHaveProperty('checked', false);
      expect(within(drawer).getByText('Handling')).toBeTruthy();
      expect(within(drawer).getByText('inferred')).toBeTruthy();
      expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBeNull();
    });

    it('saves what the person changed, without any context, and closes with a toast', async () => {
      const t = await talal();
      env.actions.saveAgent.mockResolvedValue({ ok: true, data: { id: t.id, name: 'Talal Renamed', created: false } });
      await renderScreen({ search: { agent: t.id } });
      const drawer = screen.getByRole('dialog', { name: 'Edit agent' });
      fireEvent.change(within(drawer).getByLabelText(/^Name/), { target: { value: 'Talal Renamed' } });
      fireEvent.click(within(drawer).getByRole('checkbox', { name: 'Wed' }));
      await act(async () => {
        fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
      });
      expect(env.actions.saveAgent).toHaveBeenCalledWith(expect.objectContaining({ targetId: t.id, name_en: 'Talal Renamed', zone_id: t.home_zone_id, shift_code: 'day_a', days_off: ['Sunday', 'Monday', 'Wednesday'], is_active: true }));
      expect(Object.keys(env.actions.saveAgent.mock.calls[0]?.[0] as object).sort()).toEqual(['annual_leave_days', 'code', 'days_off', 'eligible_shift_ids', 'is_active', 'name_en', 'shift_code', 'skill_codes', 'standby_point_id', 'targetId', 'vehicle_id', 'zone_id']);
      expect(await screen.findByText('Agent saved')).toBeTruthy();
      await waitFor(() => expect(env.router.replace).toHaveBeenCalledWith(expect.stringContaining('/admin/agents-vehicles'), { scroll: false }));
    });

    it('adds an agent: a code is asked for, Save waits for a name and a code, and a remote agent has no vehicle or standby point', async () => {
      await renderScreen({ search: { agent: 'new' } });
      const drawer = screen.getByRole('dialog', { name: 'Add agent' });
      expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
      expect(within(drawer).getAllByText('Enter a name').length).toBeGreaterThan(0);
      expect(within(drawer).getByLabelText('Vehicle')).toBeTruthy();
      fireEvent.change(within(drawer).getByLabelText('Zone or pool'), { target: { value: '' } });
      expect(within(drawer).queryByLabelText('Vehicle')).toBeNull();
      expect(within(drawer).queryByLabelText('Standby point')).toBeNull();
    });

    it('opens a vehicle with plate, type, zone and status, and adds one with a code', async () => {
      const vehicle = (await listVehicles(admin(), { limit: 1 })).items[0]!;
      await renderScreen({ search: { tab: 'vehicles', vehicle: vehicle.id } });
      const drawer = screen.getByRole('dialog', { name: 'Edit vehicle' });
      expect((within(drawer).getByLabelText(/Plate number/) as HTMLInputElement).value).toBe('SYN 9469');
      expect((within(drawer).getByLabelText('Type') as HTMLSelectElement).value).toBe('sedan');
      cleanup();
      await renderScreen({ search: { tab: 'vehicles', vehicle: 'new' } });
      expect(within(screen.getByRole('dialog', { name: 'Add vehicle' })).getByLabelText(/^Code/)).toBeTruthy();
    });

    it('opens the skill dialog for ?skill=new and the import dialog for ?import=1 with its sample', async () => {
      await renderScreen({ search: { tab: 'skills', skill: 'new' } });
      expect(screen.getByRole('dialog', { name: 'New skill' })).toBeTruthy();
      cleanup();
      await renderScreen({ search: { import: '1' } });
      const dialog = screen.getByRole('dialog', { name: 'Import agents' });
      expect(within(dialog).getByText('CSV, up to 2 MB')).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Use a sample file' })).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Import' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('shows an inline notice and no drawer for an id that names nothing', async () => {
      await renderScreen({ search: { agent: '00000000-0000-4000-8000-00000000dead' } });
      expect(screen.getByRole('alert').textContent).toContain('That record could not be found.');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('a role without edit access (view only)', () => {
    it('says View only, disables every writing control with the reason, and opens a drawer read only', async () => {
      await renderScreen({ access: 'view', search: { agent: (await talal()).id } });
      expect(screen.getByText('View only')).toBeTruthy();
      const add = screen.getByRole('button', { name: 'Add agent' });
      expect(add.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(add);
      expect(env.router.push).not.toHaveBeenCalled();
      const drawer = screen.getByRole('dialog', { name: 'Edit agent' });
      expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
      expect((within(drawer).getByLabelText(/^Name/) as HTMLInputElement).disabled).toBe(true);
      cleanup();
      await renderScreen({ access: 'view', search: { agent: 'new', import: '1', tab: 'skills', skill: 'new' } });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('the five states', () => {
    it('empty, loading and error, with the module text and no data read', async () => {
      const empty = await renderScreen({ state: 'empty' });
      expect(root(empty.container)?.getAttribute('data-state')).toBe('empty');
      expect(screen.getByText('Import agents or add one.')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Add agent' }).length).toBeGreaterThan(0);
      cleanup();
      const loading = await renderScreen({ state: 'loading' });
      expect(root(loading.container)?.getAttribute('data-state')).toBe('loading');
      expect(screen.getAllByText('Loading')).toHaveLength(1);
      cleanup();
      const error = await renderScreen({ state: 'error' });
      expect(root(error.container)?.getAttribute('data-state')).toBe('error');
      expect(screen.getByRole('alert').textContent).toContain('Agents could not load.');
      expect(screen.queryByText('Talal Al-Barahi')).toBeNull();
    });
  });

  describe('in Arabic', () => {
    // Names, codes and the server's English detail are data (translate="no" / lang="en"); everything else is Arabic.
    const latin = (element: HTMLElement) => {
      const clone = element.cloneNode(true) as HTMLElement;
      for (const node of clone.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
      const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].filter((el) => !/^(Select row|تحديد الصف)/.test(el.getAttribute('aria-label') ?? '')).flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
      let rest = `${clone.textContent ?? ''} ${attributes.join(' ')}`;
      // Arabic shift names are empty in the fixtures: the English name shows, as data.
      for (const code of ['RD-C', 'CSV', 'Day A']) rest = rest.split(code).join(' ');
      return (rest.match(/[A-Za-z][A-Za-z\s'.,-]*/g) ?? []).join('|').trim();
    };

    it('draws every tab, the drawers and the dialogs in Arabic with no English left over outside the data', async () => {
      for (const search of [{}, { tab: 'vehicles' }, { tab: 'skills' }, { zone: 'RD-C', shift: 'day_a' }] as SearchParams[]) {
        const { container } = await renderScreen({ locale: 'ar', search });
        expect(latin(container)).toBe('');
        cleanup();
      }
      const t = await talal();
      for (const search of [{ agent: t.id }, { agent: 'new' }, { tab: 'vehicles', vehicle: 'new' }, { tab: 'skills', skill: 'new' }, { import: '1' }] as SearchParams[]) {
        await renderScreen({ locale: 'ar', search });
        expect(latin(screen.getByRole('dialog'))).toBe('');
        cleanup();
      }
    });

    it('draws the title, the states and view-only in Arabic', async () => {
      await renderScreen({ locale: 'ar' });
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('المندوبون والمركبات');
      cleanup();
      await renderScreen({ locale: 'ar', state: 'empty' });
      expect(screen.getByText('استورد المندوبين أو أضف مندوبًا.')).toBeTruthy();
      cleanup();
      await renderScreen({ locale: 'ar', access: 'view' });
      expect(screen.getByText('عرض فقط')).toBeTruthy();
    });
  });
});
