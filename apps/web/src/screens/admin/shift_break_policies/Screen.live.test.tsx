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
import { listShiftPatterns } from '@/lib/data/time';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { ShiftBreakPoliciesScreen } from './Screen';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// The router, the actions, next-intl's server translator and the download are stood in for.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
const env = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  query: '',
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  saved: vi.fn(),
  navigate: vi.fn(),
  actions: { savePattern: vi.fn(), setPatternsStatus: vi.fn(), saveBreakRule: vi.fn(), savePrayerPolicy: vi.fn() },
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.shift_break_policies'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/shift-break-policies', useRouter: () => env.router }));
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
  const element = await ShiftBreakPoliciesScreen({ def: getModule('admin.shift_break_policies'), ctx: admin(), access: { access, reduced: false }, locale, homeHref: '/admin/shift-break-policies', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.shift_break_policies' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const idOf = async (code: string) => (await listShiftPatterns(admin(), { limit: 200 })).items.find((p) => p.code === code)!.id;
/** Postgres is shared with other live test files: the total is read fresh, never hardcoded. */
const totalPatterns = async () => (await listShiftPatterns(admin(), { limit: 1 })).page.total ?? 0;

describe.skipIf(!hasApi)('Shift and Break Policies Screen (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

  describe('filled, English, Administrator (edit)', () => {
    it('carries the four hooks the e2e specs read, the module title, the subtitle, the data source, two header actions', async () => {
      const { container } = await renderScreen();
      const page = root(container);
      expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.shift_break_policies', 'filled', 'edit', 'false']);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Shift and Break Policies');
      expect(screen.getByText('All shift times are assumptions')).toBeTruthy();
      expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Add pattern' }));
      expect(env.router.push).toHaveBeenCalledWith('/admin/shift-break-policies?pattern=new');
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit break rule', 'Export']);
    });

    it('has four figures (active, draft, break rules, hours today) and the mockup\'s table with the Assumption tag', async () => {
      const total = await totalPatterns();
      await renderScreen();
      for (const label of ['Active patterns', 'Draft patterns', 'Break rules', 'Hours today']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Normal').length).toBeGreaterThan(0);
      expect(screen.getByText('Assumption')).toBeTruthy();
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Pattern', 'Kind', 'Normal hours', 'Ramadan hours', 'Break', 'Status']));
      expect(bodyRows().length).toBeGreaterThanOrEqual(Math.min(total, 6));
    });

    it('draws a pattern row: name and code, kind tag, both hour ranges (None where it does not run), break text, status', async () => {
      await renderScreen();
      const evening = bodyRows().find((r) => r.textContent?.includes('EVENING')) as HTMLElement;
      expect(within(evening).getByText('Field')).toBeTruthy();
      expect(within(evening).getByText('None')).toBeTruthy();
      expect(within(evening).getByText('18:00 - 00:00')).toBeTruthy();
      expect(within(evening).getByText('30 min after 5 h')).toBeTruthy();
      expect(within(evening).getByText('Active')).toBeTruthy();
      const dayA = bodyRows().find((r) => r.textContent?.includes('DAY-A')) as HTMLElement;
      expect(within(dayA).getByText('06:00 - 14:00')).toBeTruthy();
    });

    it('draws the week: seven day cards with the Gregorian and the Hijri date, both ribbons, and the legend with times', async () => {
      const { container } = await renderScreen();
      expect(screen.getByRole('heading', { name: 'Week pattern' })).toBeTruthy();
      expect(container.querySelectorAll('[class*="day"]').length).toBeGreaterThanOrEqual(7);
      expect(screen.getByRole('img', { name: 'Field: Normal' })).toBeTruthy();
      expect(screen.getByRole('img', { name: 'Remote: Normal' })).toBeTruthy();
      expect(within(screen.getByRole('img', { name: 'Field: Normal' })).getAllByTitle(/Day A|Day B|Night/).length).toBeGreaterThanOrEqual(4);
      expect(screen.getAllByText('06:00 - 14:00').length).toBeGreaterThan(0);
      expect(container.querySelector('[data-rd-ribbon], [dir="ltr"]')).not.toBeNull();
    });

    it('switches the week to Ramadan hours through ?hours=, and the ribbons follow', async () => {
      await renderScreen({ search: { hours: 'ramadan' } });
      expect(screen.getByRole('radio', { name: 'Ramadan' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('img', { name: 'Field: Ramadan' })).toBeTruthy();
      expect(within(screen.getByRole('img', { name: 'Field: Ramadan' })).getAllByTitle('Evening (Ramadan only)').length).toBeGreaterThan(0);
      cleanup();
      await renderScreen();
      fireEvent.click(screen.getByRole('radio', { name: 'Ramadan' }));
      expect(env.router.replace).toHaveBeenCalledWith('/admin/shift-break-policies?hours=ramadan', { scroll: false });
    });

    it('shows the break rule card with both rules, a ribbon of the shift with its break, and the Ramadan card with a fixed Not applied switch', async () => {
      await renderScreen();
      expect(screen.getByRole('heading', { name: 'Break rule' })).toBeTruthy();
      expect(screen.getAllByText('30 min after 5 h').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole('img', { name: 'Break rule' })).toBeTruthy();
      expect(within(screen.getByRole('img', { name: 'Break rule' })).getByTitle('Break')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Ramadan hours' })).toBeTruthy();
      expect(screen.getByText('Ramadan 1447')).toBeTruthy();
      // A live pattern count, not fixed "4 vs 3".
      expect(screen.getByText(/^\d+ instead of \d+$/)).toBeTruthy();
      const toggle = screen.getByRole('switch', { name: 'Use in the Ramadan window' });
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect((toggle as HTMLButtonElement).disabled || toggle.getAttribute('aria-disabled') === 'true').toBe(true);
      expect(document.querySelector('[data-stub="notApplied"]')).not.toBeNull();
      expect(screen.getByRole('link', { name: /Calendar/ }).getAttribute('href')).toBe('/admin/leave-policy-calendar');
    });

    it('filters by kind and status from the address, and ignores what is not on an allow-list', async () => {
      await renderScreen({ search: { kind: 'remote' } });
      expect(bodyRows()).toHaveLength(2);
      expect(screen.getByText('Kind: Remote')).toBeTruthy();
      cleanup();
      const total = await totalPatterns();
      await renderScreen({ search: { kind: 'hybrid', status: 'live', q: '\u0000', pattern: 'zzz', hours: 'x' } });
      expect(bodyRows().length).toBeGreaterThanOrEqual(Math.min(total, 6));
      expect(screen.queryByRole('alert')).toBeNull();
      cleanup();
      // remote+draft: no live file ever creates that combination, so this stays truly empty.
      await renderScreen({ search: { kind: 'remote', status: 'draft' } });
      expect(screen.getByText('No match')).toBeTruthy();
    });

    it('opens a pattern through ?pattern= when its row is pressed, and exports the selected rows and sets them to draft from the bulk bar', async () => {
      await renderScreen();
      fireEvent.click(bodyRows().find((r) => r.textContent?.includes('NIGHT')) as HTMLElement);
      expect(env.navigate).toHaveBeenCalledWith(`/admin/shift-break-policies?pattern=${await idOf('NIGHT')}`);
      fireEvent.click(within(bodyRows().find((r) => r.textContent?.includes('DAY-A')) as HTMLElement).getByRole('checkbox', { name: /Select row/ }));
      env.actions.setPatternsStatus.mockResolvedValue({ ok: true, data: { changed: 1, failed: 0, status: 'draft' } });
      await act(async () => {
        fireEvent.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Set to draft' }));
      });
      expect(env.actions.setPatternsStatus).toHaveBeenCalledWith({ targetIds: [await idOf('DAY-A')], status: 'draft' });
      expect(await screen.findByText('1 patterns set to Draft')).toBeTruthy();
    });
  });

  describe('the drawer and the dialog from the address', () => {
    it('opens a pattern with name, kind, both hour ranges as time inputs, break rule and status', async () => {
      await renderScreen({ search: { pattern: await idOf('DAY-A') } });
      const drawer = screen.getByRole('dialog', { name: 'Edit pattern' });
      expect((within(drawer).getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Day A');
      expect(within(drawer).getByRole('radio', { name: 'Field' }).getAttribute('aria-checked')).toBe('true');
      const times = within(drawer).getAllByLabelText('Start') as HTMLInputElement[];
      expect(times.map((t) => t.value)).toEqual(['06:00', '06:00']);
      expect((within(drawer).getAllByLabelText('End') as HTMLInputElement[]).map((t) => t.value)).toEqual(['14:00', '12:00']);
      expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBeNull();
    });

    it('saves what the person changed, without any context', async () => {
      const dayAId = await idOf('DAY-A');
      env.actions.savePattern.mockResolvedValue({ ok: true, data: { id: dayAId, code: 'DAY-A', created: false, status: 'active' } });
      await renderScreen({ search: { pattern: dayAId } });
      const drawer = screen.getByRole('dialog', { name: 'Edit pattern' });
      fireEvent.change(within(drawer).getAllByLabelText('End')[0] as HTMLElement, { target: { value: '15:00' } });
      await act(async () => {
        fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
      });
      expect(env.actions.savePattern).toHaveBeenCalledWith(expect.objectContaining({ targetId: dayAId, name_en: 'Day A', kind: 'field', normal: { applies: true, start_time: '06:00', end_time: '15:00' }, status: 'active' }));
      expect(Object.keys(env.actions.savePattern.mock.calls[0]?.[0] as object).sort()).toEqual(['break_rule_id', 'code', 'kind', 'name_en', 'normal', 'ramadan', 'status', 'targetId']);
      expect(await screen.findByText('Pattern DAY-A updated')).toBeTruthy();
      await waitFor(() => expect(env.router.replace).toHaveBeenCalled());
    });

    it('adds a pattern: a name and a code are asked for, a code in use is refused before Save, and times must differ', async () => {
      await renderScreen({ search: { pattern: 'new' } });
      const drawer = screen.getByRole('dialog', { name: 'New pattern' });
      expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
      fireEvent.change(within(drawer).getByLabelText(/^Name/), { target: { value: 'Day C' } });
      fireEvent.change(within(drawer).getByLabelText(/^Code/), { target: { value: 'DAY-A' } });
      expect(within(drawer).getAllByText('Code already used').length).toBeGreaterThan(0);
      fireEvent.change(within(drawer).getByLabelText(/^Code/), { target: { value: 'DAY-C' } });
      // as in the mockup, both hour groups start On with the times empty: Save waits for them
      expect(within(drawer).getAllByRole('switch', { name: 'Applies' }).map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true']);
      expect(within(drawer).getAllByText('Check the times').length).toBeGreaterThan(0);
      expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
      for (const [index, [from, to]] of [['06:00', '14:00'], ['06:00', '12:00']].entries()) {
        fireEvent.change(within(drawer).getAllByLabelText('Start')[index] as HTMLElement, { target: { value: from } });
        fireEvent.change(within(drawer).getAllByLabelText('End')[index] as HTMLElement, { target: { value: to } });
      }
      expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBeNull();
      fireEvent.change(within(drawer).getAllByLabelText('End')[0] as HTMLElement, { target: { value: '06:00' } });
      expect(within(drawer).getAllByText('Check the times').length).toBeGreaterThan(0);
      expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('opens the break rule dialog for ?break=1 with the rule, the hours and the minutes, and saves them', async () => {
      env.actions.saveBreakRule.mockResolvedValue({ ok: true, data: { id: 'x', code: 'BRK-STD' } });
      await renderScreen({ search: { break: '1' } });
      const dialog = screen.getByRole('dialog', { name: 'Break rule' });
      expect(within(dialog).getByLabelText('Rule')).toBeTruthy();
      expect(within(dialog).getAllByRole('spinbutton')).toHaveLength(2);
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      });
      expect(env.actions.saveBreakRule).toHaveBeenCalledWith({ targetId: expect.stringMatching(/^[0-9a-f-]{36}$/), break_minutes: 30, after_consecutive_hours: 5 });
      expect(await screen.findByText('Break rule saved')).toBeTruthy();
    });

    it('the break rule card has its own Edit, which opens the dialog (?break=1)', async () => {
      await renderScreen();
      const card = screen.getByRole('heading', { name: 'Break rule' }).parentElement as HTMLElement;
      fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
      expect(String(env.router.push.mock.calls.at(-1)?.[0])).toContain('break=1');
    });

    it('the break rule card sets breaks and prayer: saved on change, only the choice is sent', async () => {
      env.actions.savePrayerPolicy.mockResolvedValue({ ok: true, data: { mode: 'lined_up_with_prayer', windowMinutes: 30 } });
      await renderScreen();
      expect((screen.getByRole('radio', { name: /Clear of prayer/ }) as HTMLInputElement).checked).toBe(true);
      fireEvent.click(screen.getByRole('radio', { name: /Lined up with prayer/ }));
      await waitFor(() => expect(env.actions.savePrayerPolicy).toHaveBeenCalledWith({ prayer_policy: 'lined_up_with_prayer' }));
      expect(await screen.findByText('Breaks and prayer changed')).toBeTruthy();
      const window = screen.getByRole('combobox', { name: 'Prayer window' }) as HTMLSelectElement;
      expect([...window.options].map((o) => o.value)).toHaveLength(18);
      fireEvent.change(window, { target: { value: '45' } });
      await waitFor(() => expect(env.actions.savePrayerPolicy).toHaveBeenCalledWith({ prayer_window_minutes: 45 }));
    });

    it('shows an inline notice and no drawer for an id that names nothing', async () => {
      await renderScreen({ search: { pattern: '00000000-0000-4000-8000-00000000dead' } });
      expect(screen.getByRole('alert').textContent).toContain('That pattern could not be found.');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('a role without edit access (view only)', () => {
    it('says View only, disables every writing control with the reason, opens a drawer read only, and never opens the add drawer or the break dialog from the address', async () => {
      await renderScreen({ access: 'view', search: { pattern: await idOf('DAY-A') } });
      expect(screen.getByText('View only')).toBeTruthy();
      const add = screen.getByRole('button', { name: 'Add pattern' });
      expect(add.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(add);
      expect(env.router.push).not.toHaveBeenCalled();
      const drawer = screen.getByRole('dialog', { name: 'Edit pattern' });
      expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
      expect((within(drawer).getByLabelText(/^Name/) as HTMLInputElement).disabled).toBe(true);
      cleanup();
      await renderScreen({ access: 'view', search: { pattern: 'new', break: '1' } });
      expect(screen.queryByRole('dialog')).toBeNull();
      const card = screen.getByRole('heading', { name: 'Break rule' }).parentElement as HTMLElement;
      expect(within(card).getByRole('button', { name: 'Edit' }).getAttribute('aria-disabled')).toBe('true');
    });
  });

  describe('the five states', () => {
    it('empty, loading and error, with the module text and no data read', async () => {
      const empty = await renderScreen({ state: 'empty' });
      expect(root(empty.container)?.getAttribute('data-state')).toBe('empty');
      expect(screen.getByText('Add the first pattern.')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Add pattern' }).length).toBeGreaterThan(0);
      cleanup();
      const loading = await renderScreen({ state: 'loading' });
      expect(root(loading.container)?.getAttribute('data-state')).toBe('loading');
      expect(screen.getAllByText('Loading')).toHaveLength(1);
      cleanup();
      const error = await renderScreen({ state: 'error' });
      expect(root(error.container)?.getAttribute('data-state')).toBe('error');
      expect(screen.getByRole('alert').textContent).toContain('The patterns could not load.');
      expect(screen.queryByText('Day A')).toBeNull();
    });
  });

  describe('in Arabic', () => {
    // Names, codes and times are data (translate="no" / lang="en"); the week's weekday names come from the browser's own Arabic.
    const latin = (element: HTMLElement) => {
      const clone = element.cloneNode(true) as HTMLElement;
      for (const node of clone.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
      // The ribbons name their segments after the shifts (English data, in `title`) and read them out in `aria-label`s: data too.
      for (const node of clone.querySelectorAll('[dir="ltr"]')) node.remove();
      const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].filter((el) => !/^(Select row|تحديد الصف)/.test(el.getAttribute('aria-label') ?? '')).flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
      return ((`${clone.textContent ?? ''} ${attributes.join(' ')}`).match(/[A-Za-z][A-Za-z\s'.,-]*/g) ?? []).join('|').trim();
    };

    it('draws the screen, the drawers and the dialog in Arabic with no English left over outside the data, the ribbons left to right', async () => {
      const { container } = await renderScreen({ locale: 'ar' });
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('سياسات الورديات والاستراحات');
      expect(latin(container)).toBe('');
      expect(container.querySelector('[dir="ltr"] [title]')).not.toBeNull();
      cleanup();
      for (const search of [{ hours: 'ramadan' }, { pattern: await idOf('DAY-A') }, { pattern: 'new' }, { break: '1' }] as SearchParams[]) {
        const rendered = await renderScreen({ locale: 'ar', search });
        const target = 'pattern' in search || 'break' in search ? screen.getByRole('dialog') : rendered.container;
        expect(latin(target)).toBe('');
        cleanup();
      }
    });

    it('draws the states and view-only in Arabic', async () => {
      await renderScreen({ locale: 'ar', state: 'empty' });
      expect(screen.getByText('أضف أول نمط.')).toBeTruthy();
      cleanup();
      await renderScreen({ locale: 'ar', access: 'view' });
      expect(screen.getByText('عرض فقط')).toBeTruthy();
    });
  });
});
