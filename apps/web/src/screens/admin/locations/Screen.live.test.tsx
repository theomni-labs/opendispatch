// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listCities, listStandbyPoints, listSubZones, listZones } from '@/lib/data/locations';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { LocationsScreen } from './Screen';

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the
// element it returns is rendered in each language. Locations is api-backed, so this is live: skips, never
// fakes, if OPENDISPATCH_API_URL is unset. The router, the actions, next-intl's server translator and the download are
// stood in for.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, saved: vi.fn(), navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.locations'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/locations', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ saveLocation: vi.fn(), deleteStandby: vi.fn(), importLocationsCsv: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

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
const admin = () => ctxOf('administrator');
const zoneId = async (code: string): Promise<string> => (await listZones(admin(), { limit: 200 })).items.find((z) => z.extra?.['code'] === code)?.id as string;

// Read fresh: other live tests may add cities/zones.
async function totalOf<T>(list: Promise<{ readonly items: readonly T[]; readonly page: { readonly total?: number } }>): Promise<number> {
  const result = await list;
  return result.page.total ?? result.items.length;
}
const totals = async () => ({
  cities: await totalOf(listCities(admin())),
  zones: await totalOf(listZones(admin())),
  subZones: await totalOf(listSubZones(admin())),
  standby: await totalOf(listStandbyPoints(admin())),
});

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
  const element = await LocationsScreen({ def: getModule('admin.locations'), ctx: admin(), access: { access, reduced: false }, locale, homeHref: '/admin/locations', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.locations' });
}

/** Zone codes are data: the filter chip writes one, left to right, in an Arabic sentence. */
const ZONE_CODES = ['RD-C', 'RD-N', 'RD-E', 'RD-S', 'RD-W', 'JD-N', 'JD-S', 'DM-C'];
const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

describe.skipIf(!hasApi)('Locations: filled, English, Administrator (edit)', () => {
  it('carries the four hooks the e2e specs read, the module title, and the data source of the records', async () => {
    const { container } = await renderScreen();
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.locations', 'filled', 'edit', 'false']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Locations');
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(screen.queryByText('View only')).toBeNull();
  });

  it('has at most two visible header actions: Add location and More (Import and Export inside)', async () => {
    await renderScreen();
    const add = screen.getByRole('button', { name: 'Add location' });
    expect(add.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(add);
    expect(env.router.push).toHaveBeenCalledWith('/admin/locations?edit=zone%3Anew');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Import', 'Export']);
  });

  it('has the three tabs and four summary figures: cities, zones, sub-zones, standby points', async () => {
    const { container } = await renderScreen();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Zones', 'Sub-zones', 'Standby points']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    const figures = [...container.querySelectorAll('[translate="no"]')].map((el) => el.textContent);
    const t = await totals();
    expect(figures.slice(0, 4)).toEqual([String(t.cities), String(t.zones), String(t.subZones), String(t.standby)]);
  });

  it('shows cities and zones as a tree with counts, the Arabic name affordance and status', async () => {
    await renderScreen();
    const t = await totals();
    expect(headers()).toEqual(expect.arrayContaining(['Name', 'Arabic name', 'Sub-zones', 'Standby points', 'Agents', 'Status']));
    expect(bodyRows()).toHaveLength(t.cities + t.zones);
    const riyadh = bodyRows().find((row) => row.textContent?.includes('Riyadh') && row.textContent?.includes('RD') && !row.textContent?.includes('Riyadh Central')) as HTMLElement;
    expect(within(riyadh).getByText('RD')).toBeTruthy();
    expect(within(riyadh).getByText('Add Arabic name')).toBeTruthy();
    expect(within(riyadh).getByText('English shown')).toBeTruthy();
    expect(within(riyadh).getByText('Active')).toBeTruthy();
    const central = bodyRows().find((row) => row.textContent?.includes('Riyadh Central')) as HTMLElement;
    expect(within(central).getByText('RD-C')).toBeTruthy();
    expect(central.textContent).toContain('16');
  });

  it('collapses a city with its expander, and puts the zones back', async () => {
    await renderScreen();
    // Api order is unstable: find Riyadh's own row.
    const riyadh = () => bodyRows().find((row) => row.textContent?.includes('Riyadh') && row.textContent?.includes('RD') && !row.textContent?.includes('Riyadh Central')) as HTMLElement;
    const before = bodyRows().length;
    fireEvent.click(within(riyadh()).getByRole('button', { name: 'Expand or collapse' }));
    expect(bodyRows()).toHaveLength(before - 5);
    fireEvent.click(within(riyadh()).getByRole('button', { name: 'Expand or collapse' }));
    expect(bodyRows()).toHaveLength(before);
  });

  it('opens a city or a zone through ?edit= when its row is pressed (a push: Back closes the drawer)', async () => {
    await renderScreen();
    fireEvent.click(bodyRows().find((row) => row.textContent?.includes('Riyadh Central')) as HTMLElement);
    expect(env.navigate).toHaveBeenCalledWith(`/admin/locations?edit=zone%3A${await zoneId('RD-C')}`);
  });

  it('draws the map with the stage of each zone and the city switch, Riyadh selected', async () => {
    // Pin ?city=RD: the api's city order is unstable.
    const { container } = await renderScreen({ search: { city: 'RD' } });
    expect(screen.getByRole('heading', { name: 'Map' })).toBeTruthy();
    const cities = within(screen.getByRole('radiogroup', { name: 'Map' })).getAllByRole('radio');
    expect(cities.map((c) => c.textContent)).toEqual(expect.arrayContaining(['Riyadh', 'Jeddah', 'Dammam']));
    const riyadh = cities.find((c) => c.textContent === 'Riyadh') as HTMLElement;
    expect(riyadh.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('[data-map-plot]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /RD-C: Recommend/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /RD-E: Shadow/ })).toBeTruthy();
  });

  it('switches the map to another city and writes it to the address', async () => {
    await renderScreen({ search: { city: 'RD' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Jeddah' }));
    expect(env.router.replace).toHaveBeenCalledWith('/admin/locations?city=JD', { scroll: false });
    expect(screen.getByRole('button', { name: /JD-N/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /RD-C/ })).toBeNull();
  });

  it('exports every record in the columns the import reads, from the More menu', async () => {
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    const [filename, table] = env.saved.mock.calls[0] as [string, { header: string[]; rows: string[][] }];
    expect(filename).toBe('locations.csv');
    expect(table.header).toEqual(['kind', 'code', 'parent_code', 'name_en', 'name_ar', 'latitude', 'longitude', 'coverage_radius_m', 'sub_zone_code']);
    const t = await totals();
    expect(table.rows).toHaveLength(t.cities + t.zones + t.subZones + t.standby);
    // Unstable order: find the row, not index 0.
    expect(table.rows.find((row) => row[0] === 'city' && row[1] === 'RD')).toEqual(['city', 'RD', '', 'Riyadh', '', '', '', '', '']);
    expect(table.rows.find((row) => row[1] === 'RD-C')).toEqual(['zone', 'RD-C', 'RD', 'Riyadh Central', '', '24.71', '46.68', '', '']);
    expect(await screen.findByText('Locations exported')).toBeTruthy();
  });
});

describe.skipIf(!hasApi)('Locations: the sub-zone and standby tabs', () => {
  it('lists sub-zones with the five columns, a zone filter, search and the summary', async () => {
    await renderScreen({ search: { tab: 'subs', zone: 'RD-C' } });
    expect(headers()).toEqual(expect.arrayContaining(['Name', 'Arabic name', 'Zone', 'Code', 'Status']));
    expect(bodyRows()).toHaveLength(16);
    expect(screen.getByText(/^16 of \d+$/)).toBeTruthy();
    expect(screen.getByText('Zone: RD-C')).toBeTruthy();
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Import' }).length).toBeGreaterThan(0);
  });

  it('searches by name or code', async () => {
    await renderScreen({ search: { tab: 'subs', q: 'RD-N-0' } });
    expect(bodyRows()).toHaveLength(9);
    cleanup();
    await renderScreen({ search: { tab: 'subs', q: 'juniper square' } });
    expect(bodyRows()).toHaveLength(1);
  });

  it('lists standby points with radius and sub-zone, and opens one through ?edit=', async () => {
    await renderScreen({ search: { tab: 'standby', zone: 'RD-C' } });
    expect(headers()).toEqual(expect.arrayContaining(['Name', 'Arabic name', 'Zone', 'Sub-zone', 'Radius (m)', 'Status']));
    expect(bodyRows()).toHaveLength(3);
    expect(screen.getByText(/^3 of \d+$/)).toBeTruthy();
    const row = bodyRows()[0] as HTMLElement;
    expect(row.textContent).toContain('4,500');
    const point = (await listStandbyPoints(admin(), { zone_id: await zoneId('RD-C') })).items[0];
    fireEvent.click(row);
    expect(env.navigate).toHaveBeenCalledWith(expect.stringMatching(/\?tab=standby&zone=RD-C&edit=standby%3A/));
    expect(point).toBeDefined();
  });

  it('shows "No locations match" with Clear all when nothing matches', async () => {
    await renderScreen({ search: { tab: 'subs', q: 'zzz-nothing' } });
    expect(screen.getByText('No locations match')).toBeTruthy();
    expect(screen.getByText(/^0 of \d+$/)).toBeTruthy();
  });

  it('ignores an address that is not on its allow-list: no zone filter, first tab', async () => {
    await renderScreen({ search: { tab: 'evil', zone: 'ZZ; DROP', page: '-3', q: '\u0000', sort: 'x:asc' } });
    const t = await totals();
    expect(bodyRows()).toHaveLength(t.cities + t.zones);
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
  });
});

describe.skipIf(!hasApi)('Locations: the drawer from the address', () => {
  it('opens a zone on first paint with its fields, its stage chip and Save', async () => {
    await renderScreen({ search: { edit: `zone:${await zoneId('RD-C')}` } });
    const drawer = screen.getByRole('dialog', { name: 'Edit zone' });
    expect(within(drawer).getByLabelText(/Name \(English\)/)).toHaveProperty('value', 'Riyadh Central');
    expect(within(drawer).getByLabelText(/^Code/)).toHaveProperty('readOnly', true);
    expect(within(drawer).getByLabelText(/Latitude/)).toHaveProperty('value', '24.71');
    expect(within(drawer).getByLabelText('Radius (km)')).toHaveProperty('value', '6');
    expect(within(drawer).getByText('Recommend')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('opens a standby point with its sub-zone and a Delete button, and a sub-zone with its position', async () => {
    // Unstable order: find RD-C-SP1 by its code.
    const point = (await listStandbyPoints(admin(), { zone_id: await zoneId('RD-C') })).items.find((p) => p.extra?.['code'] === 'RD-C-SP1');
    await renderScreen({ search: { edit: `standby:${point?.id}` } });
    const drawer = screen.getByRole('dialog', { name: 'Edit standby point' });
    expect(within(drawer).getByLabelText(/Coverage radius/)).toHaveProperty('value', '4500');
    expect(within(drawer).getByRole('button', { name: 'Delete' })).toBeTruthy();
    cleanup();
    const sub = (await listSubZones(admin(), { limit: 200 })).items[0];
    await renderScreen({ search: { edit: `sub_zone:${sub?.id}` } });
    const subDrawer = screen.getByRole('dialog', { name: 'Edit sub-zone' });
    expect(within(subDrawer).getByLabelText(/Latitude/)).toBeTruthy();
    expect(within(subDrawer).queryByLabelText(/Radius/)).toBeNull();
  });

  it('opens a city with no position fields', async () => {
    // Unstable order: find Riyadh by its code.
    const city = (await listCities(admin())).items.find((c) => c.case_code === 'RD');
    await renderScreen({ search: { edit: `city:${city?.id}` } });
    const drawer = screen.getByRole('dialog', { name: 'Edit city' });
    expect(within(drawer).queryByLabelText(/Latitude/)).toBeNull();
    expect(within(drawer).getByLabelText(/Name \(English\)/)).toHaveProperty('value', 'Riyadh');
  });

  it('opens the add drawer for ?edit=zone:new with the type choice, and Save waits for a name and a code', async () => {
    await renderScreen({ search: { edit: 'zone:new' } });
    const drawer = screen.getByRole('dialog', { name: 'Add zone' });
    expect(within(drawer).getByLabelText('Type')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(drawer).getAllByText('Enter a name and code').length).toBeGreaterThan(0);
  });

  it('opens with the Arabic field focused for "Add Arabic name" (?ar=1)', async () => {
    await renderScreen({ search: { edit: `zone:${await zoneId('RD-C')}`, ar: '1' } });
    const field = screen.getByRole('dialog').querySelector('[data-autofocus]') as HTMLElement;
    expect(field.getAttribute('lang')).toBe('ar');
  });

  it('shows an inline notice and no drawer for an id that names nothing, and ignores a malformed one', async () => {
    await renderScreen({ search: { edit: 'zone:00000000-0000-4000-8000-00000000dead' } });
    expect(screen.getByRole('alert').textContent).toContain('That location could not be found.');
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    await renderScreen({ search: { edit: 'zone:nonsense' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the import dialog for ?import=1 with the CSV drop area, its limit and the sample link', async () => {
    await renderScreen({ search: { import: '1' } });
    const dialog = screen.getByRole('dialog', { name: 'Import locations' });
    expect(within(dialog).getByText('CSV, up to 5 MB')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Use a sample file' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Import' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('gives the CSV drop area its type and size limits', async () => {
    await renderScreen({ search: { import: '1' } });
    const input = screen.getByRole('dialog').querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('.csv');
    const big = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText('big.csv is larger than 5 MB.')).toBeTruthy();
    const wrong = new File(['x'], 'places.xlsx');
    fireEvent.change(input, { target: { files: [wrong] } });
    expect(await screen.findByText('places.xlsx is not an accepted file type.')).toBeTruthy();
  });
});

describe.skipIf(!hasApi)('Locations: a role without edit access (view only)', () => {
  it('says View only, and shows every writing control disabled with the reason', async () => {
    await renderScreen({ access: 'view' });
    expect(screen.getByText('View only')).toBeTruthy();
    const add = screen.getByRole('button', { name: 'Add location' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(add);
    expect(env.router.push).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Import' }).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Add Arabic name' }).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Import' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the drawer readable with Save disabled, and does not open the add drawer or the import dialog from the address', async () => {
    await renderScreen({ access: 'view', search: { edit: `zone:${await zoneId('RD-C')}` } });
    const drawer = screen.getByRole('dialog', { name: 'Edit zone' });
    expect(within(drawer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(drawer).getByLabelText(/Name \(English\)/)).toHaveProperty('disabled', true);
    cleanup();
    await renderScreen({ access: 'view', search: { edit: 'zone:new', import: '1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe.skipIf(!hasApi)('Locations: the five states', () => {
  it('empty: the module\'s own text and Import', async () => {
    const { container } = await renderScreen({ state: 'empty' });
    expect(root(container)?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('Import or add a city to start.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Import' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('empty for a view-only role: the action is there, disabled', async () => {
    await renderScreen({ state: 'empty', access: 'view' });
    expect(screen.getAllByRole('button', { name: 'Import' }).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
  });

  it('loading: skeletons in a card, announced once, the header kept', async () => {
    const { container } = await renderScreen({ state: 'loading' });
    expect(root(container)?.getAttribute('data-state')).toBe('loading');
    expect(screen.getAllByText('Loading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Locations');
  });

  it('error: "Locations could not load." as an alert with Try again', async () => {
    const { container } = await renderScreen({ state: 'error' });
    expect(root(container)?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('Locations could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a review state reads no data', async () => {
    await renderScreen({ state: 'empty' });
    expect(screen.queryByText('Riyadh Central')).toBeNull();
  });
});

describe.skipIf(!hasApi)('Locations in Arabic', () => {
  // Names, codes and the server's English detail are data (translate="no" / lang="en"); everything else is Arabic.
  const untranslated = (container: HTMLElement) => {
    const clone = container.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll('[translate="no"], [lang="en"], [data-map-plot]')) node.remove();
    const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].filter((el) => !/^(Select row|تحديد الصف)/.test(el.getAttribute('aria-label') ?? '')).flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
    return `${clone.textContent ?? ''} ${attributes.join(' ')}`;
  };
  /** What is left of the Latin script once the data values are taken out: it should be empty, and says what is not translated. */
  const latin = (element: HTMLElement) => {
    let rest = untranslated(element);
    for (const code of ZONE_CODES) rest = rest.split(code).join(' ');
    rest = rest.replace(/\bCSV\b/g, ' '); // a file format's name, as the mockup writes it
    return (rest.match(/[A-Za-z][A-Za-z\s'.,-]*/g) ?? []).join('|').trim();
  };

  it('draws the tree and the map in Arabic with no English left over outside the data', async () => {
    // Pin ?city=RD: the default city may have no zones.
    const { container } = await renderScreen({ locale: 'ar', search: { city: 'RD' } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('المواقع');
    expect(latin(container)).toBe('');
    expect(screen.getByRole('button', { name: 'إضافة موقع' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['المناطق', 'المناطق الفرعية', 'نقاط التمركز']);
    expect(container.querySelector('[data-badge="SYNTHETIC"]')?.textContent).toBe('اصطناعية');
    expect(container.querySelector('[data-map-plot]')?.getAttribute('dir')).toBe('ltr');
  });

  it('draws the other tabs, the drawers and the import dialog in Arabic with no English left over', async () => {
    for (const search of [{ tab: 'subs', zone: 'RD-C' }, { tab: 'standby' }] as SearchParams[]) {
      const { container } = await renderScreen({ locale: 'ar', search });
      expect(latin(container)).toBe('');
      cleanup();
    }
    await renderScreen({ locale: 'ar', search: { edit: `zone:${await zoneId('RD-C')}` } });
    expect(latin(screen.getByRole('dialog'))).toBe('');
    cleanup();
    await renderScreen({ locale: 'ar', search: { edit: 'standby:new' } });
    expect(latin(screen.getByRole('dialog'))).toBe('');
    cleanup();
    await renderScreen({ locale: 'ar', search: { import: '1' } });
    expect(latin(screen.getByRole('dialog'))).toBe('');
  });

  it('draws the states in Arabic', async () => {
    await renderScreen({ locale: 'ar', state: 'empty' });
    expect(screen.getByText('استورد مدينة أو أضفها للبدء.')).toBeTruthy();
    cleanup();
    await renderScreen({ locale: 'ar', state: 'error' });
    expect(screen.getByText('تعذّر تحميل المواقع.')).toBeTruthy();
  });

  it('shows view-only in Arabic with the Arabic reason', async () => {
    await renderScreen({ locale: 'ar', access: 'view' });
    expect(screen.getByText('عرض فقط')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'إضافة موقع' }).getAttribute('aria-disabled')).toBe('true');
  });
});
