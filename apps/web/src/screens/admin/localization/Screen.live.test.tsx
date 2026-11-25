// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import type { ScreenProps } from '@/screens/types';
import * as actions from './actions';
import { LocalizationScreen } from './Screen';
import { DEFAULT_SETTINGS } from './types';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// loadLocalizationView reads api-backed locations (Cities);
// the review states bypass it: see Screen.test.tsx.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the element
// it returns is rendered in each language. The data layer is real (the fixtures, a temp demo store); the router, the actions and
// next-intl's server translator are stood in for.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.localization'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/localization', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('./actions', () => ({ saveLocalization: vi.fn(), resetLocalization: vi.fn() }));

const mocked = <K extends keyof typeof actions>(name: K) => actions[name] as unknown as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetGoTestState();
});
afterEach(() => {
  cleanup();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.navigate]) mock.mockReset();
  for (const name of Object.keys(actions) as (keyof typeof actions)[]) mocked(name).mockReset();
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
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', access = 'edit', mode = 'private', state }: Options = {}) {
  env.locale = locale;
  const element = await LocalizationScreen({ def: getModule('admin.localization'), ctx: ctxOf('administrator', mode), access: { access, reduced: false }, locale, homeHref: '/', state, searchParams: {} });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.localization' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const isDisabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
const save = () => screen.getByRole('button', { name: 'Save' });
const radio = (name: string) => screen.getByRole('radio', { name });

describe.skipIf(!hasApi)('Localization Screen (live, real api and Postgres)', () => {
  describe('Localization: filled, Administrator (edit)', () => {
    it('carries the four hooks the e2e specs read, the module title and the data source', async () => {
      const { container } = await renderScreen();
      const page = root(container);
      expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.localization', 'filled', 'edit', 'false']);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Localization');
      expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
      expect(screen.queryByText('View only')).toBeNull();
    });

    it('has two header actions: Save (unavailable while nothing changed) and More with Reset to defaults', async () => {
      await renderScreen();
      expect(save().getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Reset to defaults']);
    });

    it('shows the settings the data layer holds: English, Western digits, Gregorian with the secondary calendar, Sunday, and a fixed time zone', async () => {
      await renderScreen();
      expect(radio('English').hasAttribute('checked') || (radio('English') as HTMLInputElement).checked).toBe(true);
      expect((radio('Western digits') as HTMLInputElement).checked).toBe(true);
      expect(screen.getByRole('radio', { name: 'Gregorian' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('switch', { name: 'Show secondary calendar' }).getAttribute('aria-checked')).toBe('true');
      expect((screen.getByLabelText('First day of week') as HTMLSelectElement).value).toBe('sunday');
      const zone = screen.getAllByLabelText('Time zone').find((el) => el.tagName === 'SELECT') as HTMLSelectElement;
      expect(zone.disabled).toBe(true);
      expect(zone.textContent).toContain('Asia/Riyadh (UTC+03:00)');
      expect(screen.getByText('Fixed for this install')).toBeTruthy();
    });

    it('labels every setting "Not applied" (stored and audited, nothing changes how a page is drawn) and the preview Illustrative', async () => {
      const { container } = await renderScreen();
      expect(container.querySelectorAll('[data-stub="notApplied"]').length).toBe(4);
      expect(screen.getAllByText('Illustrative')).toHaveLength(1);
      expect(screen.getByRole('heading', { name: 'Preview' })).toBeTruthy();
    });

    it('shows the Arabic names table: eight kinds with their record counts and how many have an Arabic name', async () => {
      await renderScreen();
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Data', 'Records', 'Arabic', 'Coverage']);
      const rows = bodyRows().map((row) => [...row.querySelectorAll('td')].slice(0, 3).map((cell) => cell.textContent));
      // Cities/Zones/Sub-zones/Standby points: api-backed, live
      // Postgres, other live tests may add rows (never
      // Arabic ones), so only their own count floats.
      // Other live tests may add shift/break rows.
      const MIN_RECORDS: Readonly<Record<string, number>> = { Cities: 3, Zones: 8, 'Sub-zones': 124, 'Standby points': 32, 'Case types': 3, 'Shift patterns': 6, 'Break rules': 2, Holidays: 7 };
      const MIN_ARABIC: Readonly<Record<string, number>> = { Holidays: 7 };
      expect(rows.map((r) => r[0])).toEqual(['Cities', 'Zones', 'Sub-zones', 'Standby points', 'Case types', 'Shift patterns', 'Break rules', 'Holidays']);
      for (const [label, records, arabic] of rows) {
        expect(Number(records)).toBeGreaterThanOrEqual(MIN_RECORDS[label as string] ?? 0);
        expect(Number(arabic)).toBeGreaterThanOrEqual(MIN_ARABIC[label as string] ?? 0);
      }
      const byLabel = new Map(rows.map((r) => [r[0], r] as const));
      expect(byLabel.get('Case types')).toEqual(['Case types', '3', '0']);
      expect(screen.getByText('English shows where Arabic is empty.')).toBeTruthy();
      const bars = screen.getAllByRole('progressbar');
      expect(bars).toHaveLength(8);
      expect(bars[4]?.getAttribute('aria-valuenow')).toBe('0'); // Case types
    });

    it('shows the fallback preview: English with a tag where Arabic is empty, the Arabic name where it exists', async () => {
      await renderScreen();
      const card = screen.getByRole('heading', { name: 'Fallback preview' }).closest('div') as HTMLElement;
      expect(card.parentElement?.querySelectorAll('dt').length).toBe(3); // zone, case type, holiday
      expect(within(card.parentElement as HTMLElement).getAllByText('English').length).toBeGreaterThanOrEqual(2);
      expect(card.parentElement?.querySelector('[lang="ar"]')?.textContent).toMatch(/[؀-ۿ]/);
    });

    it('shows the preview in Arabic and in English under the form\'s settings, with the default language tagged', async () => {
      const { container } = await renderScreen();
      const ar = container.querySelector('[data-preview="ar"]') as HTMLElement;
      const en = container.querySelector('[data-preview="en"]') as HTMLElement;
      for (const label of ['Date', 'Date and time', 'Number', 'Percent', 'Time', 'Week starts']) {
        expect(within(ar).getByText(label)).toBeTruthy();
        expect(within(en).getByText(label)).toBeTruthy();
      }
      expect(within(en).getByText('Default')).toBeTruthy();
      expect(within(ar).queryByText('Default')).toBeNull();
      expect(within(en).getByText('1,234,567.8')).toBeTruthy();
      expect(within(en).getByText('Sunday')).toBeTruthy();
      expect(/[٠-٩]/.test(ar.textContent ?? '')).toBe(false);
    });
  });

  describe('Localization: changing the settings', () => {
    it('follows each control in the preview at once, and makes Save available: the default language, the digits, the calendars and the first day', async () => {
      const { container } = await renderScreen();
      const ar = container.querySelector('[data-preview="ar"]') as HTMLElement;
      const en = container.querySelector('[data-preview="en"]') as HTMLElement;
      fireEvent.click(radio('Arabic'));
      expect(within(ar).getByText('Default')).toBeTruthy();
      expect(within(en).queryByText('Default')).toBeNull();
      expect(save().hasAttribute('aria-disabled')).toBe(false);
      fireEvent.click(radio('Arabic-Indic digits'));
      expect(/[٠-٩]/.test(ar.textContent ?? '')).toBe(true);
      expect(/[٠-٩]/.test(en.textContent ?? '')).toBe(false);
      fireEvent.click(screen.getByRole('radio', { name: 'Hijri' }));
      expect(within(en).getAllByText(/1448/).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('switch', { name: 'Show secondary calendar' }));
      expect(en.textContent).not.toContain('·');
      fireEvent.change(screen.getByLabelText('First day of week'), { target: { value: 'monday' } });
      expect(within(en).getByText('Monday')).toBeTruthy();
      expect(within(ar).getByText('الاثنين')).toBeTruthy();
    });

    it('saves the five settings in one action, and says so', async () => {
      mocked('saveLocalization').mockResolvedValue({ ok: true, data: { ...DEFAULT_SETTINGS, default_locale: 'ar' } });
      await renderScreen();
      fireEvent.click(radio('Arabic'));
      fireEvent.click(radio('Arabic-Indic digits'));
      fireEvent.click(screen.getByRole('radio', { name: 'Hijri' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Show secondary calendar' }));
      fireEvent.change(screen.getByLabelText('First day of week'), { target: { value: 'saturday' } });
      fireEvent.click(save());
      await waitFor(() => expect(mocked('saveLocalization')).toHaveBeenCalledWith({ default_locale: 'ar', digit_system: 'arabic_indic', primary_calendar: 'hijri', show_secondary_calendar: false, first_day_of_week: 'saturday' }));
      expect(await screen.findByText('Localization saved')).toBeTruthy();
      const sent = mocked('saveLocalization').mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent).not.toHaveProperty('time_zone');
    });

    it('keeps the form and shows the data layer\'s refusal with its English detail marked as English', async () => {
      mocked('saveLocalization').mockResolvedValue({ ok: false, code: 'invalid', message: 'Localization: first_day_of_week must be one of saturday, sunday, monday.' });
      await renderScreen();
      fireEvent.click(radio('Arabic'));
      fireEvent.click(save());
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Check the details and try again.');
      expect(alert.querySelector('[lang="en"]')?.textContent).toContain('first_day_of_week');
      expect((radio('Arabic') as HTMLInputElement).checked).toBe(true);
    });

    it('asks before it resets to the defaults, then writes them through the action and says so', async () => {
      mocked('resetLocalization').mockResolvedValue({ ok: true, data: DEFAULT_SETTINGS });
      await renderScreen();
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Reset to defaults' }));
      const confirm = screen.getByRole('dialog', { name: 'Reset to defaults?' });
      expect(mocked('resetLocalization')).not.toHaveBeenCalled();
      fireEvent.click(within(confirm).getByRole('button', { name: 'Reset' }));
      await waitFor(() => expect(mocked('resetLocalization')).toHaveBeenCalledWith());
      expect(await screen.findByText('Defaults restored')).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reset to defaults?' })).toBeNull());
    });
  });

  describe('Localization: a role without edit access (view only)', () => {
    it('says View only and shows every control disabled with the reason', async () => {
      const { container } = await renderScreen({ access: 'view' });
      expect(root(container)?.getAttribute('data-access')).toBe('view');
      expect(screen.getByText('View only')).toBeTruthy();
      expect(isDisabled(save())).toBe(true);
      for (const name of ['Arabic', 'English', 'Western digits', 'Arabic-Indic digits']) expect(radio(name).hasAttribute('disabled'), name).toBe(true);
      expect(screen.getByRole('switch', { name: 'Show secondary calendar' }).hasAttribute('disabled')).toBe(true);
      expect((screen.getByLabelText('First day of week') as HTMLSelectElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      expect(isDisabled(screen.getByRole('menuitem', { name: 'Reset to defaults' }))).toBe(true);
      fireEvent.click(save());
      expect(mocked('saveLocalization')).not.toHaveBeenCalled();
    });

    it('does not let the segmented calendar choice change the draft', async () => {
      await renderScreen({ access: 'view' });
      fireEvent.click(screen.getByRole('radio', { name: 'Hijri' }));
      expect(screen.getByRole('radio', { name: 'Gregorian' }).getAttribute('aria-checked')).toBe('true');
    });
  });

  describe('Localization in Arabic', () => {
    // Zone and case type names are data (translate="no"); the digits sample of the Arabic-Indic option is Arabic-Indic on purpose.
    const untranslated = (container: HTMLElement) => {
      const clone = container.cloneNode(true) as HTMLElement;
      for (const node of clone.querySelectorAll('[translate="no"], [lang="en"], [lang="ar"]')) node.remove();
      const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
      return `${clone.textContent ?? ''} ${attributes.join(' ')}`.replace(/\b(OpenDispatch)\b/g, ' ');
    };

    it('draws the page in Arabic with no English left over outside the data', async () => {
      const { container } = await renderScreen({ locale: 'ar' });
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('اللغة والإعدادات الإقليمية');
      expect(untranslated(container).match(/[A-Za-z]{2,}/g)?.join(',') ?? '').toBe('');
      expect(screen.getByRole('button', { name: 'حفظ' })).toBeTruthy();
    });

    it('writes the counts in Western digits, and the Arabic-Indic sample only inside the option that names it', async () => {
      const { container } = await renderScreen({ locale: 'ar' });
      const table = container.querySelector('table') as HTMLElement;
      expect(/[٠-٩]/.test(table.textContent ?? '')).toBe(false);
      const outside = container.cloneNode(true) as HTMLElement;
      for (const node of outside.querySelectorAll('[data-preview="ar"], [translate="no"][dir="ltr"]')) node.remove();
      expect(/[٠-٩]/.test(outside.textContent ?? '')).toBe(false);
    });
  });
});
