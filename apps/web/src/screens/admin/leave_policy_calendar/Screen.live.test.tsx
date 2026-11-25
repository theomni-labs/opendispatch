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
import { listHolidays } from '@/lib/data/time';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { LeavePolicyCalendarScreen } from './Screen';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Holidays are shared Postgres; the total is read fresh, never hardcoded.
// The screen as the module route renders it. The router, the actions, next-intl's server translator and the download are stood
// in for; the writes are all mocked, so this file never mutates a real holiday. The demo day is the real one, so every test
// names its month or day in the address and asserts nothing that depends on today.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
const env = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  query: '',
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  saved: vi.fn(),
  navigate: vi.fn(),
  actions: { saveHoliday: vi.fn(), removeHoliday: vi.fn(), recomputePrayer: vi.fn(), savePolicy: vi.fn(), saveRange: vi.fn(), removeRange: vi.fn(), setPayday: vi.fn(), readNotice: vi.fn(), saveNotice: vi.fn() },
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.leave_policy_calendar'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/leave-policy-calendar', useRouter: () => env.router }));
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
  const element = await LeavePolicyCalendarScreen({ def: getModule('admin.leave_policy_calendar'), ctx: admin(), access: { access, reduced: false }, locale, homeHref: '/admin/leave-policy-calendar', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.leave_policy_calendar' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const holidayId = async (name: string): Promise<string> => (await listHolidays(admin(), { limit: 200 })).items.find((h) => h.name_en === name)!.id;
const liveHolidayCount = async (): Promise<number> => (await listHolidays(admin(), { limit: 200 })).page.total ?? 0;

describe.skipIf(!hasApi)('Leave Policy and Calendar Screen (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

  describe('filled, English, Administrator (edit)', () => {
    it('carries the four hooks the e2e specs read, the module title, the subtitle, the data source, two header actions', async () => {
      const { container } = await renderScreen();
      const page = root(container);
      expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.leave_policy_calendar', 'filled', 'edit', 'false']);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Leave Policy and Calendar');
      expect(screen.getByText('Hijri dates by Umm al-Qura')).toBeTruthy();
      expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Add holiday' }));
      expect(env.router.push).toHaveBeenCalledWith('/admin/leave-policy-calendar?holiday=new');
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Recompute prayer times', 'Export']);
    });

    it('has the five tabs and four figures: holidays, Ramadan days, days to National Day, cities', async () => {
      const total = await liveHolidayCount();
      const { container } = await renderScreen({ search: { month: '2026-09' } });
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Calendar', `Holidays${total}`, 'Prayer times', 'Leave policy', 'Events']);
      for (const label of ['Holidays in 2026', 'Ramadan days', 'Days to National Day', 'Cities']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      const figures = [...container.querySelectorAll('[translate="no"]')].map((el) => el.textContent);
      expect(figures).toEqual(expect.arrayContaining([String(total), '30', '3']));
    });

    it('draws the Gregorian month asked for: a grid with the seven weekdays, the holiday, the Ramadan days, the controls and the legend', async () => {
      await renderScreen({ search: { month: '2026-03' } });
      const grid = screen.getByRole('grid', { name: 'March 2026' });
      expect(within(grid).getAllByRole('columnheader')).toHaveLength(7);
      expect(within(grid).getAllByRole('button', { name: 'Eid al-Fitr' })).toHaveLength(3); // a holiday of three days names each day
      expect(grid.querySelectorAll('[data-date]')).toHaveLength(31);
      expect(within(grid).getAllByText('Ramadan').length).toBe(19);
      expect(screen.getByRole('radiogroup', { name: 'Calendar' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Gregorian' }).getAttribute('aria-checked')).toBe('true');
      for (const name of ['Previous month', 'Today', 'Next month']) expect(screen.getByRole('button', { name })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Ramadan 1447/ })).toBeTruthy();
      expect(screen.getByRole('switch', { name: 'Show Hijri dates' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('switch', { name: 'Mark Ramadan' })).toBeTruthy();
    });

    it('moves through the address: previous and next month, back to today, Ramadan, and the calendar switch', async () => {
      await renderScreen({ search: { month: '2026-03' } });
      fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
      expect(env.router.replace).toHaveBeenLastCalledWith('/admin/leave-policy-calendar?month=2026-02', { scroll: false });
      cleanup();
      await renderScreen({ search: { month: '2026-03' } });
      fireEvent.click(screen.getByRole('button', { name: 'Today' }));
      expect(env.router.replace).toHaveBeenLastCalledWith('/admin/leave-policy-calendar', { scroll: false });
      cleanup();
      await renderScreen({ search: { month: '2026-09' } });
      fireEvent.click(screen.getByRole('button', { name: /Ramadan 1447/ }));
      expect(env.router.replace).toHaveBeenLastCalledWith('/admin/leave-policy-calendar?month=2026-02', { scroll: false });
      cleanup();
      await renderScreen({ search: { month: '2026-03' } });
      fireEvent.click(screen.getByRole('radio', { name: 'Hijri' }));
      expect(env.router.replace).toHaveBeenLastCalledWith('/admin/leave-policy-calendar?cal=hijri', { scroll: false });
    });

    it('draws a Hijri month from the reference table, and has no previous month at the start of the table', async () => {
      await renderScreen({ search: { cal: 'hijri', month: '1447-09' } });
      expect(screen.getByRole('radio', { name: 'Hijri' }).getAttribute('aria-checked')).toBe('true');
      const grid = screen.getByRole('grid');
      expect(grid.querySelectorAll('[data-date]')).toHaveLength(30);
      expect(grid.getAttribute('aria-label')).toMatch(/1447$/);
      cleanup();
      await renderScreen({ search: { cal: 'hijri', month: '1447-07' } });
      const previous = screen.getByRole('button', { name: 'Previous month' });
      expect(previous.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(previous);
      expect(env.router.replace).not.toHaveBeenCalled();
    });

    it('opens a holiday through ?holiday= when its name in the grid is pressed (a push)', async () => {
      await renderScreen({ search: { month: '2026-09' } });
      fireEvent.click(screen.getByRole('button', { name: 'Saudi National Day' }));
      expect(env.router.push).toHaveBeenCalledWith(`/admin/leave-policy-calendar?month=2026-09&holiday=${await holidayId('Saudi National Day')}`);
    });
  });

  describe('holidays, prayer times, leave policy', () => {
    it('lists the holidays with type, Gregorian and Hijri dates and days, filters by type, and opens one through the address', async () => {
      const total = await liveHolidayCount();
      await renderScreen({ search: { tab: 'holidays' } });
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Holiday', 'Type', 'Gregorian', 'Hijri', 'Days']));
      expect(bodyRows().length).toBeGreaterThanOrEqual(Math.min(total, 7));
      const adha = bodyRows().find((r) => r.textContent?.includes('Eid al-Adha')) as HTMLElement;
      expect(within(adha).getByText('Public')).toBeTruthy();
      expect(adha.textContent).toContain('27 May 2026 - 30 May 2026');
      expect(adha.textContent).toContain('4');
      fireEvent.click(adha);
      expect(env.navigate).toHaveBeenCalledWith(`/admin/leave-policy-calendar?tab=holidays&holiday=${await holidayId('Eid al-Adha')}`);
      cleanup();
      await renderScreen({ search: { tab: 'holidays', type: 'observance' } });
      expect(bodyRows().length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Type: Observance')).toBeTruthy();
      cleanup();
      await renderScreen({ search: { tab: 'holidays', q: 'zzz' } });
      expect(screen.getByText('No match')).toBeTruthy();
    });

    it('shows the prayer times of the day for every city, stored or computed, and moves by day', async () => {
      await renderScreen({ search: { tab: 'prayer', date: '2026-09-08' } });
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['City', 'Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);
      // One row per city; other live files may add one.
      expect(bodyRows().length).toBeGreaterThanOrEqual(3);
      expect(within(bodyRows()[0] as HTMLElement).getAllByText(/^\d{2}:\d{2}$/)).toHaveLength(6);
      expect(screen.getByText('Umm al-Qura')).toBeTruthy();
      expect(screen.getByText('Stored')).toBeTruthy();
      expect(screen.getByText(/Stored from 6 Sept 2026 to 12 Sept 2026/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
      expect(env.router.replace).toHaveBeenLastCalledWith('/admin/leave-policy-calendar?tab=prayer&date=2026-09-09', { scroll: false });
      cleanup();
      await renderScreen({ search: { tab: 'prayer', date: '2026-11-01' } });
      expect(screen.getByText('Computed')).toBeTruthy();
    });

    it('recomputes a week of prayer times from the day shown, from the More menu', async () => {
      env.actions.recomputePrayer.mockResolvedValue({ ok: true, data: { cities: 3, days: 7, records: 21 } });
      await renderScreen({ search: { tab: 'prayer', date: '2026-09-08' } });
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: 'Recompute prayer times' }));
      });
      expect(env.actions.recomputePrayer).toHaveBeenCalledWith({ date_from: '2026-09-08', date_to: '2026-09-14' });
      expect(await screen.findByText('3 cities, 7 days, 21 records')).toBeTruthy();
    });

    it('shows the leave policy: Illustrative, the notice, the share, and no blackout periods; Save waits for a change', async () => {
      await renderScreen({ search: { tab: 'policy' } });
      expect(screen.getByRole('heading', { name: 'Leave rules' })).toBeTruthy();
      expect(screen.getByText('Illustrative')).toBeTruthy();
      const [notice, share] = screen.getAllByRole('spinbutton') as HTMLInputElement[];
      expect([notice?.value, share?.value]).toEqual(['7', '15']);
      expect(screen.getByText('No periods')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
      expect(screen.queryByText('Unsaved changes')).toBeNull();
    });

    it('saves a changed policy: Unsaved changes shows, Reset puts it back, and what is sent is what was typed (no context)', async () => {
      env.actions.savePolicy.mockResolvedValue({ ok: true, data: { saved: true } });
      await renderScreen({ search: { tab: 'policy' } });
      const notice = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
      fireEvent.change(notice, { target: { value: '10' } });
      fireEvent.blur(notice);
      expect(await screen.findByText('Unsaved changes')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
      fireEvent.change(notice, { target: { value: '10' } });
      fireEvent.blur(notice);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBeNull());
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });
      expect(env.actions.savePolicy).toHaveBeenCalledWith({ min_notice_days: 10, share_percent: 15, blackout_periods: [] });
      expect(await screen.findByText('Leave policy updated')).toBeTruthy();
    });

    it('opens the Add period dialog for ?blackout=new, which needs a label and two ordered dates', async () => {
      await renderScreen({ search: { tab: 'policy', blackout: 'new' } });
      const dialog = screen.getByRole('dialog', { name: 'Add period' });
      expect(within(dialog).getByRole('button', { name: 'Add period' }).getAttribute('aria-disabled')).toBe('true');
      expect(within(dialog).getAllByText('Add a label').length).toBeGreaterThan(0);
      fireEvent.change(within(dialog).getByLabelText(/^Label/), { target: { value: 'Year end' } });
      fireEvent.change(within(dialog).getAllByLabelText(/^From/)[0] as HTMLElement, { target: { value: '2026-12-20' } });
      fireEvent.change(within(dialog).getAllByLabelText(/^To/)[0] as HTMLElement, { target: { value: '2026-12-10' } });
      expect(within(dialog).getAllByText('End is before start').length).toBeGreaterThan(0);
      fireEvent.change(within(dialog).getAllByLabelText(/^To/)[0] as HTMLElement, { target: { value: '2026-12-31' } });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add period' }));
      });
      expect(env.router.replace).toHaveBeenCalledWith('/admin/leave-policy-calendar?tab=policy', { scroll: false });
    });
  });

  describe('the Events tab', () => {
    it('lists the payday day, the ranges set here (none yet), the derived events read only, and says Customer\'s calendar is not set up', async () => {
      await renderScreen({ search: { tab: 'events' } });
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Feature', 'Dates', 'Source', 'Actions']);
      for (const text of ['Set here', 'Derived, read only', "From the customer's planning calendar, read only", 'Payday day', 'Day 27 of each month', 'Assumption, Customer to confirm', 'School term', 'Season event', 'Umrah window']) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
      expect(screen.getByText("Customer's planning calendar is not set up: the events above are all the forecaster gets")).toBeTruthy();
      expect(screen.getAllByText('National Day').length).toBeGreaterThan(0);
      expect(screen.getAllByRole('button', { name: 'Derived, not editable' }).length).toBeGreaterThanOrEqual(3);
      expect(screen.getAllByText('Illustrative').length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: 'Add date range' }));
      expect(env.router.push).toHaveBeenCalledWith('/admin/leave-policy-calendar?tab=events&ev=new&evkind=school');
    });

    it('adds a range from the dialog: a name and two ordered dates, sent with no context', async () => {
      env.actions.saveRange.mockResolvedValue({ ok: true, data: { id: 'x', name: 'Term 1', created: true } });
      await renderScreen({ search: { tab: 'events', ev: 'new', evkind: 'season' } });
      const dialog = screen.getByRole('dialog', { name: 'New date range' });
      expect(within(dialog).getByText('Add a name')).toBeTruthy();
      fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Riyadh Season' } });
      const [from, to] = within(dialog).getAllByLabelText(/^(From|To)/) as HTMLInputElement[];
      fireEvent.change(from as HTMLInputElement, { target: { value: '2026-10-10' } });
      fireEvent.change(to as HTMLInputElement, { target: { value: '2026-10-01' } });
      expect(within(dialog).getByText('End is before start')).toBeTruthy();
      fireEvent.change(to as HTMLInputElement, { target: { value: '2027-03-31' } });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      });
      expect(env.actions.saveRange).toHaveBeenCalledWith({ kind: 'season', name: 'Riyadh Season', start_date: '2026-10-10', end_date: '2027-03-31' });
    });

    it('sets the payday day from its dialog, which wants a day from 1 to 31', async () => {
      env.actions.setPayday.mockResolvedValue({ ok: true, data: { payday_day: 25 } });
      await renderScreen({ search: { tab: 'events', pay: '1' } });
      const dialog = screen.getByRole('dialog', { name: 'Payday day' });
      const input = within(dialog).getByLabelText(/^Day of month/) as HTMLInputElement;
      expect(input.value).toBe('27');
      fireEvent.change(input, { target: { value: '40' } });
      expect(within(dialog).getAllByText('Enter a day from 1 to 31').length).toBeGreaterThan(0);
      fireEvent.change(input, { target: { value: '25' } });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      });
      expect(env.actions.setPayday).toHaveBeenCalledWith({ payday_day: 25 });
    });

    it('opens no dialog from the address and disables the writes for a view-only role', async () => {
      await renderScreen({ access: 'view', search: { tab: 'events', ev: 'new', pay: '1' } });
      expect(screen.queryByRole('dialog')).toBeNull();
      const add = screen.getByRole('button', { name: 'Add date range' });
      expect(add.getAttribute('aria-disabled') === 'true' || add.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('the holiday dialog from the address', () => {
    it('opens a holiday with its names, its dates with the Hijri date under them, its type, and Save and Delete', async () => {
      await renderScreen({ search: { holiday: await holidayId('Saudi National Day') } });
      const dialog = screen.getByRole('dialog', { name: 'Edit holiday' });
      expect((within(dialog).getByLabelText(/^Name, English/) as HTMLInputElement).value).toBe('Saudi National Day');
      expect((within(dialog).getByLabelText(/^Name, Arabic/) as HTMLInputElement).value).toBe('اليوم الوطني');
      expect((within(dialog).getAllByLabelText(/^From/)[0] as HTMLInputElement).value).toBe('2026-09-23');
      expect(within(dialog).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBeNull();
      expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeTruthy();
    });

    it('saves what the person changed, without any context, and deletes after a confirmation', async () => {
      const founding = await holidayId('Founding Day');
      env.actions.saveHoliday.mockResolvedValue({ ok: true, data: { id: founding, name: 'Founding Day 2', created: false } });
      env.actions.removeHoliday.mockResolvedValue({ ok: true, data: { id: founding, name: 'Founding Day', created: false } });
      await renderScreen({ search: { holiday: founding } });
      const dialog = screen.getByRole('dialog', { name: 'Edit holiday' });
      fireEvent.change(within(dialog).getByLabelText(/^Name, English/), { target: { value: 'Founding Day 2' } });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      });
      expect(env.actions.saveHoliday).toHaveBeenCalledWith({ targetId: founding, name_en: 'Founding Day 2', name_ar: 'يوم التأسيس', start_date: '2026-02-22', end_date: '2026-02-22', kind: 'public' });
      expect(await screen.findByText('Founding Day 2 updated')).toBeTruthy();
      cleanup();
      await renderScreen({ search: { holiday: founding } });
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Edit holiday' })).getByRole('button', { name: 'Delete' }));
      const confirm = screen.getByRole('dialog', { name: 'Delete Founding Day?' });
      await act(async () => {
        fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
      });
      expect(env.actions.removeHoliday).toHaveBeenCalledWith({ targetId: founding });
    });

    it('adds a holiday: a name and two ordered dates are asked for, and the type starts as public', async () => {
      await renderScreen({ search: { holiday: 'new' } });
      const dialog = screen.getByRole('dialog', { name: 'New holiday' });
      fireEvent.change(within(dialog).getByLabelText(/^Name, English/), { target: { value: '' } });
      expect(within(dialog).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
      expect(within(dialog).getAllByText('Add a name').length).toBeGreaterThan(0);
      expect((within(dialog).getByLabelText('Type') as HTMLSelectElement).value).toBe('public');
      expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('shows an inline notice and no dialog for an id that names nothing', async () => {
      await renderScreen({ search: { holiday: '00000000-0000-4000-8000-00000000dead' } });
      expect(screen.getByRole('alert').textContent).toContain('That holiday could not be found.');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('a role without edit access (view only)', () => {
    it('says View only, disables every writing control with the reason, opens a holiday read only, and never opens the add dialog or the period dialog from the address', async () => {
      await renderScreen({ access: 'view', search: { tab: 'policy' } });
      expect(screen.getByText('View only')).toBeTruthy();
      const add = screen.getByRole('button', { name: 'Add holiday' });
      expect(add.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(add);
      expect(env.router.push).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByRole('button', { name: 'Add period' }).getAttribute('aria-disabled')).toBe('true');
      cleanup();
      await renderScreen({ access: 'view', search: { holiday: await holidayId('Founding Day') } });
      const dialog = screen.getByRole('dialog', { name: 'Edit holiday' });
      expect(within(dialog).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
      expect((within(dialog).getByLabelText(/^Name, English/) as HTMLInputElement).disabled).toBe(true);
      cleanup();
      await renderScreen({ access: 'view', search: { holiday: 'new', blackout: 'new', tab: 'policy' } });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('the five states', () => {
    it('empty, loading and error, with the module text and no data read', async () => {
      const empty = await renderScreen({ state: 'empty' });
      expect(root(empty.container)?.getAttribute('data-state')).toBe('empty');
      expect(screen.getByText('Add the first holiday.')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Add holiday' }).length).toBeGreaterThan(0);
      cleanup();
      const loading = await renderScreen({ state: 'loading' });
      expect(root(loading.container)?.getAttribute('data-state')).toBe('loading');
      expect(screen.getAllByText('Loading')).toHaveLength(1);
      cleanup();
      const error = await renderScreen({ state: 'error' });
      expect(root(error.container)?.getAttribute('data-state')).toBe('error');
      expect(screen.getByRole('alert').textContent).toContain('The calendar could not load.');
      expect(screen.queryByRole('grid')).toBeNull();
    });
  });

  describe('in Arabic', () => {
    // Holiday names and city names are data (translate="no" / lang="en"); the month's name and the weekdays are the browser's own Arabic.
    const latin = (element: HTMLElement) => {
      const clone = element.cloneNode(true) as HTMLElement;
      for (const node of clone.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
      const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].filter((el) => !/^(Select row|تحديد الصف)/.test(el.getAttribute('aria-label') ?? '')).flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
      return ((`${clone.textContent ?? ''} ${attributes.join(' ')}`).match(/[A-Za-z][A-Za-z\s'.,-]*/g) ?? []).join('|').trim();
    };

    it('draws every tab and the dialogs in Arabic with no English left over outside the data, Western digits, the grid mirrored', async () => {
      for (const search of [{ month: '2026-03' }, { cal: 'hijri', month: '1447-09' }, { tab: 'holidays' }, { tab: 'prayer', date: '2026-09-08' }, { tab: 'policy' }, { tab: 'events' }] as SearchParams[]) {
        const { container } = await renderScreen({ locale: 'ar', search });
        expect(latin(container)).toBe('');
        expect(/[٠-٩]/.test(container.textContent ?? '')).toBe(false);
        cleanup();
      }
      const founding = await holidayId('Founding Day');
      for (const search of [{ holiday: founding }, { holiday: 'new' }, { tab: 'policy', blackout: 'new' }, { tab: 'events', ev: 'new' }, { tab: 'events', pay: '1' }] as SearchParams[]) {
        await renderScreen({ locale: 'ar', search });
        expect(latin(screen.getByRole('dialog'))).toBe('');
        cleanup();
      }
    });

    it('draws the title, the states and view-only in Arabic', async () => {
      await renderScreen({ locale: 'ar' });
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('سياسة الإجازات والتقويم');
      cleanup();
      await renderScreen({ locale: 'ar', state: 'empty' });
      expect(screen.getByText('أضف أول عطلة.')).toBeTruthy();
      cleanup();
      await renderScreen({ locale: 'ar', access: 'view' });
      expect(screen.getByText('عرض فقط')).toBeTruthy();
    });
  });
});
