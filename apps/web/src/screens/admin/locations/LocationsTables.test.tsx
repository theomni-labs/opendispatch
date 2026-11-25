// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { LocationMap, StandbyTable, SubZonesTable, ZonesTree } from './LocationsTables';
import type { CityRow, MapStandby, StandbyRow, SubZoneRow, ZoneRow } from './types';

const env = vi.hoisted(() => ({ query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/locations', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));

beforeEach(() => {
  env.query = '';
  env.router.push.mockReset();
  env.router.replace.mockReset();
  env.navigate.mockReset();
});
afterEach(cleanup);

const cities: CityRow[] = [
  { id: 'c1', code: 'RD', name: 'Riyadh', nameAr: null, active: true, zoneIds: ['z1', 'z2'] },
  { id: 'c2', code: 'JD', name: 'Jeddah', nameAr: 'جدة', active: false, zoneIds: ['z3'] },
];
const zone = (overrides: Partial<ZoneRow>): ZoneRow => ({ id: 'z1', cityId: 'c1', cityCode: 'RD', code: 'RD-C', name: 'Riyadh Central', nameAr: null, latitude: 24.71, longitude: 46.68, radiusKm: 6, active: true, stage: 'recommend', subZones: 16, standbyPoints: 3, agents: 31, ...overrides });
const zones: ZoneRow[] = [zone({}), zone({ id: 'z2', code: 'RD-N', name: 'Riyadh North', latitude: 24.81, stage: 'shadow', subZones: 17, agents: 32 }), zone({ id: 'z3', cityId: 'c2', cityCode: 'JD', code: 'JD-N', name: 'Jeddah North', latitude: 21.6, longitude: 39.17, subZones: 15, standbyPoints: 3, agents: 32, nameAr: 'شمال جدة' })];
const pins: MapStandby[] = [
  { id: 'p1', zoneCode: 'RD-C', name: 'Garnet Terrace standby', latitude: 24.738, longitude: 46.721 },
  { id: 'p2', zoneCode: 'JD-N', name: 'Vista Heights standby', latitude: 21.616, longitude: 39.135 },
];

const inShell = (locale: 'en' | 'ar', ui: React.ReactNode) => inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{ui}</DesignSystemProvider>, { module: 'admin.locations' });
const rows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const tree = (props: Partial<Parameters<typeof ZonesTree>[0]> = {}) => <ZonesTree cities={cities} zones={zones} selectedZone={undefined} canEdit caption="Cities and zones" {...props} />;

describe('ZonesTree', () => {
  it('lists each city with the sums of its zones, then its zones, with the Arabic name or the way to add one', () => {
    inShell('en', tree());
    expect(rows()).toHaveLength(5);
    const riyadh = rows()[0] as HTMLElement;
    expect(within(riyadh).getByText('RD')).toBeTruthy();
    expect(riyadh.textContent).toContain('33'); // 16 + 17 sub-zones
    expect(riyadh.textContent).toContain('63'); // 31 + 32 agents
    expect(within(riyadh).getByText('Add Arabic name')).toBeTruthy();
    const jeddah = rows().find((row) => row.textContent?.includes('Jeddah') && !row.textContent.includes('Jeddah North')) as HTMLElement;
    expect(within(jeddah).getByText('جدة').getAttribute('lang')).toBe('ar');
    expect(within(jeddah).getByText('Inactive')).toBeTruthy();
  });

  it('marks the selected zone', () => {
    inShell('en', tree({ selectedZone: 'RD-N' }));
    const north = rows().find((row) => row.textContent?.includes('Riyadh North')) as HTMLElement;
    const central = rows().find((row) => row.textContent?.includes('Riyadh Central')) as HTMLElement;
    expect(north.className).not.toBe(central.className);
  });

  it('opens the Arabic-name form with a push and does not also open the row', () => {
    inShell('en', tree());
    fireEvent.click(within(rows()[1] as HTMLElement).getByRole('button', { name: 'Add Arabic name' }));
    expect(env.router.push).toHaveBeenCalledWith('/admin/locations?edit=zone%3Az1&ar=1');
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it('opens a row through the address, and the expander does not', () => {
    inShell('en', tree());
    fireEvent.click(rows()[0] as HTMLElement);
    expect(env.navigate).toHaveBeenCalledWith('/admin/locations?edit=city%3Ac1');
    env.navigate.mockReset();
    fireEvent.click(within(rows()[0] as HTMLElement).getByRole('button', { name: 'Expand or collapse' }));
    expect(env.navigate).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(3);
  });

  it('disables "Add Arabic name" with the reason for a person who may not edit', () => {
    inShell('en', tree({ canEdit: false }));
    const button = within(rows()[1] as HTMLElement).getByRole('button', { name: 'Add Arabic name' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(env.router.push).not.toHaveBeenCalled();
  });
});

describe('SubZonesTable and StandbyTable', () => {
  const subs: SubZoneRow[] = [
    { id: 's1', zoneId: 'z1', zoneCode: 'RD-C', code: 'RD-C-02', name: 'Garnet Row', nameAr: null, latitude: 24.7, longitude: 46.7, active: true },
    { id: 's2', zoneId: 'z1', zoneCode: 'RD-C', code: 'RD-C-01', name: 'Juniper Square', nameAr: 'ساحة', latitude: 24.7, longitude: 46.7, active: true },
  ];
  const points: StandbyRow[] = [
    { id: 'p1', zoneId: 'z1', zoneCode: 'RD-C', subZoneId: 's1', subZoneName: 'Garnet Row', code: 'RD-C-SP1', name: 'Garnet Row standby', nameAr: null, latitude: 24.7, longitude: 46.7, radiusM: 4500, active: true },
    { id: 'p2', zoneId: 'z1', zoneCode: 'RD-C', subZoneId: null, subZoneName: null, code: 'RD-C-SP2', name: 'Loose standby', nameAr: null, latitude: 24.7, longitude: 46.7, radiusM: 1200, active: false },
  ];

  it('sorts the sub-zones by code when the header is pressed, and writes the sort to the address', () => {
    inShell('en', <SubZonesTable rows={subs} caption="Sub-zones" canEdit emptyState={null} />);
    expect(rows().map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual(['Garnet Row', 'Juniper Square']);
    fireEvent.click(screen.getByRole('button', { name: /Code/ }));
    expect(rows().map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual(['Juniper Square', 'Garnet Row']);
    expect(env.router.replace).toHaveBeenLastCalledWith('/admin/locations?sort=code%3Aasc', { scroll: false });
  });

  it('opens a sub-zone through ?edit= with its own kind', () => {
    inShell('en', <SubZonesTable rows={subs} caption="Sub-zones" canEdit emptyState={null} />);
    fireEvent.click(rows()[0] as HTMLElement);
    expect(env.navigate).toHaveBeenCalledWith('/admin/locations?edit=sub_zone%3As1');
  });

  it('shows a standby point with its code under the name, radius, sub-zone or a dash, and status', () => {
    inShell('en', <StandbyTable rows={points} caption="Standby points" canEdit emptyState={null} />);
    const first = rows()[0] as HTMLElement;
    expect(first.textContent).toContain('RD-C-SP1');
    expect(first.textContent).toContain('4,500');
    expect(first.textContent).toContain('Garnet Row');
    expect(rows()[1]?.textContent).toContain('Inactive');
    fireEvent.click(rows()[1] as HTMLElement);
    expect(env.navigate).toHaveBeenCalledWith('/admin/locations?edit=standby%3Ap2');
  });

  it('shows the empty state it is given when there are no rows', () => {
    inShell('en', <SubZonesTable rows={[]} caption="Sub-zones" canEdit emptyState={<p>No locations match</p>} />);
    expect(screen.getByText('No locations match')).toBeTruthy();
  });
});

describe('LocationMap', () => {
  const map = (props: Partial<Parameters<typeof LocationMap>[0]> = {}) => <LocationMap cities={cities} zones={zones} standby={pins} initialCity={undefined} selectedZone={undefined} {...props} />;

  it('draws the zones of the first city with their stage and its standby points, and the city switch', () => {
    inShell('en', map());
    expect(screen.getByRole('button', { name: /RD-C: Recommend/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /RD-N: Shadow/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Garnet Terrace standby/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /JD-N/ })).toBeNull();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Riyadh', 'Jeddah']);
  });

  it('opens on the city the address asks for', () => {
    inShell('en', map({ initialCity: 'JD' }));
    expect(screen.getByRole('button', { name: /JD-N/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Jeddah' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a pin opens its standby point with a push', () => {
    inShell('en', map());
    fireEvent.click(screen.getByRole('button', { name: /Garnet Terrace standby/ }));
    expect(env.router.push).toHaveBeenCalledWith('/admin/locations?edit=standby%3Ap1');
  });

  it('a zone selects itself, and selecting it again clears it', () => {
    inShell('en', map());
    fireEvent.click(screen.getByRole('button', { name: /RD-N/ }));
    expect(env.router.replace).toHaveBeenLastCalledWith('/admin/locations?zone=RD-N', { scroll: false });
    cleanup();
    env.query = 'zone=RD-N';
    inShell('en', map({ selectedZone: 'RD-N' }));
    fireEvent.click(screen.getByRole('button', { name: /RD-N/ }));
    expect(env.router.replace).toHaveBeenLastCalledWith('/admin/locations', { scroll: false });
  });

  it('has no city switch for one city, and shows the map\'s own empty state for a city with no positioned zone', () => {
    inShell('en', map({ cities: [cities[0] as CityRow], zones: zones.map((z) => ({ ...z, latitude: null, longitude: null })) }));
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('button', { name: /RD-C/ })).toBeNull();
  });
});
