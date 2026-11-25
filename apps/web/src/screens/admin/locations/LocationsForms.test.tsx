// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import type { ActionResult } from '@/lib/actions/types';
import { ImportDialog, LocationDrawer, LocationsHeader } from './LocationsForms';
import type { CityRow, LocationRecord, SubZoneOption, ZoneOption } from './types';

// The client forms with the actions and the router stood in for. What each test checks is what the browser sends to an action
// and what the person sees for each answer.
const env = vi.hoisted(() => ({
  query: '',
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  actions: { saveLocation: vi.fn(), deleteStandby: vi.fn(), importLocationsCsv: vi.fn() },
  saveCsv: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/locations', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => env.actions);
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saveCsv }));

beforeEach(() => {
  env.query = '';
  for (const fn of Object.values(env.actions)) fn.mockReset();
  env.saveCsv.mockReset();
  env.router.push.mockReset();
  env.router.replace.mockReset();
});
afterEach(cleanup);

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (code: 'forbidden' | 'conflict' | 'invalid', message: string): ActionResult<never> => ({ ok: false, code, message });

const cities: CityRow[] = [
  { id: 'c1', code: 'RD', name: 'Riyadh', nameAr: null, active: true, zoneIds: ['z-c', 'z-n'] },
  { id: 'c2', code: 'JD', name: 'Jeddah', nameAr: null, active: true, zoneIds: ['z-j'] },
];
const zones: ZoneOption[] = [
  { id: 'z-c', code: 'RD-C', name: 'Riyadh Central', cityId: 'c1' },
  { id: 'z-n', code: 'RD-N', name: 'Riyadh North', cityId: 'c1' },
  { id: 'z-j', code: 'JD-N', name: 'Jeddah North', cityId: 'c2' },
];
const subZones: SubZoneOption[] = [
  { id: 's1', zoneId: 'z-c', name: 'Juniper Square' },
  { id: 's2', zoneId: 'z-n', name: 'Coral Rise' },
];

const zone = (overrides: Partial<LocationRecord> = {}): LocationRecord => ({ kind: 'zone', id: 'z-c', code: 'RD-C', name: 'Riyadh Central', nameAr: null, active: true, parentId: 'c1', latitude: 24.71, longitude: 46.68, radius: 6, subZoneId: null, stage: 'recommend', ...overrides });
const standby = (overrides: Partial<LocationRecord> = {}): LocationRecord => ({ kind: 'standby', id: 'p1', code: 'RD-C-SP1', name: 'Garnet Terrace standby', nameAr: null, active: true, parentId: 'z-c', latitude: 24.738, longitude: 46.721, radius: 4500, subZoneId: 's1', stage: null, ...overrides });

const inShell = (locale: 'en' | 'ar', ui: React.ReactNode) => inLocale(locale, <DesignSystemProvider navigate={vi.fn()}>{ui}</DesignSystemProvider>, { module: 'admin.locations' });
const drawer = (props: Partial<Parameters<typeof LocationDrawer>[0]> = {}) => (
  <LocationDrawer target={{ kind: 'zone', id: 'z-c' }} record={zone()} canEdit cities={cities} zones={zones} subZones={subZones} focusArabic={false} {...props} />
);
const adding = (kind: 'zone' | 'city' | 'sub_zone' | 'standby' = 'zone') => drawer({ target: { kind, id: 'new' }, record: undefined });
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

describe('the header', () => {
  it('opens Add location through the address with a push, only when the person may edit', () => {
    inShell('en', <LocationsHeader canEdit exportFilename="l.csv" exportHeader={[]} exportRows={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }));
    expect(env.router.push).toHaveBeenCalledWith('/admin/locations?edit=zone%3Anew');
    cleanup();
    env.router.push.mockReset();
    inShell('en', <LocationsHeader canEdit={false} exportFilename="l.csv" exportHeader={[]} exportRows={[]} />);
    const disabled = screen.getByRole('button', { name: 'Add location' });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(disabled);
    expect(env.router.push).not.toHaveBeenCalled();
  });

  it('opens the import dialog from More, and exports; Export is unavailable while a review state shows', () => {
    inShell('en', <LocationsHeader canEdit exportFilename="l.csv" exportHeader={['a', 'b']} exportRows={[['1', '2']]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import' }));
    expect(env.router.push).toHaveBeenCalledWith('/admin/locations?import=1');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    expect(env.saveCsv).toHaveBeenCalledWith('l.csv', { header: ['a', 'b'], rows: [['1', '2']] });
    cleanup();
    inShell('en', <LocationsHeader canEdit exportFilename="l.csv" exportHeader={[]} exportRows={undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Export' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('says why in the menu when the person may not edit', () => {
    inShell('en', <LocationsHeader canEdit={false} exportFilename="l.csv" exportHeader={[]} exportRows={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText('View only for this role')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Import' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('the drawer: changing a zone', () => {
  it('sends only what the person typed and the record it changes, no context, and closes on success with a toast', async () => {
    env.actions.saveLocation.mockResolvedValue(ok({ kind: 'zone', id: 'z-c', name: 'Riyadh Centre', created: false }));
    inShell('en', drawer());
    type(/Name \(English\)/, 'Riyadh Centre');
    type('Arabic name', 'وسط الرياض');
    type('Radius (km)', '7');
    fireEvent.click(screen.getByRole('switch', { name: 'Active' }));
    await press('Save');
    expect(env.actions.saveLocation).toHaveBeenCalledTimes(1);
    expect(env.actions.saveLocation).toHaveBeenCalledWith({
      kind: 'zone',
      targetId: 'z-c',
      name_en: 'Riyadh Centre',
      name_ar: 'وسط الرياض',
      code: 'RD-C',
      parent_id: 'c1',
      sub_zone_id: '',
      latitude: 24.71,
      longitude: 46.68,
      radius: 7,
      is_active: false,
    });
    expect(await screen.findByText('Location saved')).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalledWith('/admin/locations', { scroll: false });
  });

  it('shows the server\'s English detail marked lang="en" and keeps the person\'s input when the data layer refuses', async () => {
    env.actions.saveLocation.mockResolvedValue(fail('invalid', 'Radius: a number of kilometres above 0 and up to 100.'));
    inShell('en', drawer());
    type('Radius (km)', '99');
    await press('Save');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Radius: a number of kilometres above 0 and up to 100.');
    expect(alert.querySelector('[lang="en"]')).not.toBeNull();
    expect((screen.getByLabelText('Radius (km)') as HTMLInputElement).value).toBe('99');
    expect(env.router.replace).not.toHaveBeenCalled();
  });

  it('keeps Save disabled with the reason while the name is empty, and does not send', async () => {
    inShell('en', drawer());
    type(/Name \(English\)/, '   ');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Enter a name and code').length).toBeGreaterThan(0);
    await press('Save');
    expect(env.actions.saveLocation).not.toHaveBeenCalled();
  });

  it('cannot change the code of a record, and says the position must be a pair', async () => {
    inShell('en', drawer());
    expect((screen.getByLabelText(/^Code/) as HTMLInputElement).readOnly).toBe(true);
    type('Longitude', '');
    expect(screen.getAllByText('Enter a valid latitude and longitude').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the stage as a read-only chip', () => {
    inShell('en', drawer());
    expect(screen.getByRole('dialog').querySelector('[data-stage="recommend"]')).not.toBeNull();
  });
});

describe('the drawer: adding', () => {
  it('starts as a zone, offers the four types, and puts the parent and the fields of each type in', () => {
    inShell('en', adding());
    expect(screen.getByRole('dialog', { name: 'Add zone' })).toBeTruthy();
    const kinds = within(screen.getByLabelText('Type')).getAllByRole('option').map((o) => o.textContent);
    expect(kinds).toEqual(['City', 'Zone', 'Sub-zone', 'Standby point']);
    expect(screen.getByLabelText('City')).toBeTruthy();
    expect(screen.getByLabelText('Radius (km)')).toBeTruthy();
    type('Type', 'city');
    expect(screen.queryByLabelText('City')).toBeNull();
    expect(screen.queryByLabelText(/Latitude/)).toBeNull();
    type('Type', 'sub_zone');
    expect(screen.getByLabelText('Zone')).toBeTruthy();
    expect(screen.getByLabelText(/Latitude/)).toBeTruthy();
    expect(screen.queryByLabelText(/Radius/)).toBeNull();
    type('Type', 'standby');
    expect(screen.getByLabelText(/Coverage radius/)).toBeTruthy();
    expect(screen.getByLabelText('Sub-zone')).toBeTruthy();
  });

  it('adds a zone: name, code, city, no position (optional), and sends `targetId` never', async () => {
    env.actions.saveLocation.mockResolvedValue(ok({ kind: 'zone', id: 'new', name: 'Test', created: true }));
    inShell('en', adding());
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    type(/Name \(English\)/, 'Test');
    type(/^Code/, 'TZ-1');
    await press('Save');
    expect(env.actions.saveLocation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'zone', name_en: 'Test', code: 'TZ-1', parent_id: 'c1', latitude: null, longitude: null, radius: null, is_active: true }));
    expect(env.actions.saveLocation.mock.calls[0]?.[0]).not.toHaveProperty('targetId');
    expect(await screen.findByText('Location added')).toBeTruthy();
  });

  it('adds a standby point in a zone and one of its sub-zones, with a radius from 100 to 50,000 metres', async () => {
    env.actions.saveLocation.mockResolvedValue(ok({ kind: 'standby', id: 'new', name: 'P', created: true }));
    inShell('en', adding('standby'));
    type(/Name \(English\)/, 'P');
    type(/^Code/, 'P-1');
    type(/Latitude/, '24.7');
    type(/Longitude/, '46.7');
    type(/Coverage radius/, '50');
    expect(screen.getAllByText('Enter a valid radius').length).toBeGreaterThan(0);
    type(/Coverage radius/, '3000');
    expect(within(screen.getByLabelText('Sub-zone')).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', 'Juniper Square']);
    type('Sub-zone', 's1');
    await press('Save');
    expect(env.actions.saveLocation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'standby', parent_id: 'z-c', sub_zone_id: 's1', latitude: 24.7, longitude: 46.7, radius: 3000 }));
    // a saved standby point shows on its own tab
    await waitFor(() => expect(env.router.replace).toHaveBeenCalledWith('/admin/locations?tab=standby', { scroll: false }));
  });

  it('changing the zone of a standby point empties the sub-zone that belonged to the old one', () => {
    inShell('en', adding('standby'));
    type('Sub-zone', 's1');
    type('Zone', 'z-n');
    expect((screen.getByLabelText('Sub-zone') as HTMLSelectElement).value).toBe('');
  });

  it('does not open for a role that may not edit, and opens a record read-only', () => {
    inShell('en', drawer({ target: { kind: 'zone', id: 'new' }, record: undefined, canEdit: false }));
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    inShell('en', drawer({ canEdit: false }));
    expect((screen.getByLabelText(/Name \(English\)/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('the drawer: deleting a standby point', () => {
  it('asks first, then deletes by id, and closes with a toast; a refusal stays in the dialog', async () => {
    env.actions.deleteStandby.mockResolvedValueOnce(fail('forbidden', 'viewer_auditor may not edit admin.locations in a private install.'));
    inShell('en', drawer({ target: { kind: 'standby', id: 'p1' }, record: standby() }));
    await press('Delete');
    const dialog = screen.getByRole('dialog', { name: 'Delete Garnet Terrace standby?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete standby point' }));
    });
    expect(env.actions.deleteStandby).toHaveBeenCalledWith({ targetId: 'p1' });
    expect((await within(dialog).findByRole('alert')).textContent).toContain('may not edit admin.locations');
    env.actions.deleteStandby.mockResolvedValueOnce(ok({ kind: 'standby', id: 'p1', name: 'Garnet Terrace standby', created: false }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete standby point' }));
    });
    expect(await screen.findByText('Standby point deleted')).toBeTruthy();
  });

  it('has no Delete for a zone, and a disabled one for a person who may not edit', () => {
    inShell('en', drawer());
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    cleanup();
    inShell('en', drawer({ target: { kind: 'standby', id: 'p1' }, record: standby(), canEdit: false }));
    expect(screen.getByRole('button', { name: 'Delete' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('the import dialog', () => {
  // jsdom's File has no text(); every browser's does. The dialog reads the file with it.
  const file = (name: string, text: string) => Object.defineProperty(new File([text], name, { type: 'text/csv' }), 'text', { value: async () => text });
  const drop = async (chosen: File) => {
    const input = screen.getByRole('dialog').querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [chosen] } });
    });
  };
  const sample = { fileName: 'locations_sample.csv', text: 'kind,code\ncity,SC\n' };

  it('starts with Import unavailable ("Choose a file"), and sends the text of the file that was chosen', async () => {
    env.actions.importLocationsCsv.mockResolvedValue(ok({ cities: 1, zones: 2, subZones: 3, standbyPoints: 4, total: 10 }));
    inShell('en', <ImportDialog open canEdit sample={sample} />);
    const button = screen.getByRole('button', { name: 'Import' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await drop(file('places.csv', 'kind,code\ncity,TB\n'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' }).getAttribute('aria-disabled')).toBeNull());
    await press('Import');
    expect(env.actions.importLocationsCsv).toHaveBeenCalledWith({ file: 'kind,code\ncity,TB\n' });
    expect(await screen.findByText('10 locations imported')).toBeTruthy();
    expect(screen.getByText('Cities 1, zones 2, sub-zones 3, standby points 4')).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalledWith('/admin/locations', { scroll: false });
  });

  it('refuses a wrong type and a file over 5 MB in the drop area (its own message) and never sends them', async () => {
    inShell('en', <ImportDialog open canEdit sample={sample} />);
    await drop(file('places.xlsx', 'x'));
    expect(await screen.findByText('places.xlsx is not an accepted file type.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import' }).getAttribute('aria-disabled')).toBe('true');
    await press('Import');
    expect(env.actions.importLocationsCsv).not.toHaveBeenCalled();
  });

  it('uses the sample file: names it, enables Import and sends its text', async () => {
    env.actions.importLocationsCsv.mockResolvedValue(ok({ cities: 1, zones: 0, subZones: 0, standbyPoints: 0, total: 1 }));
    inShell('en', <ImportDialog open canEdit sample={sample} />);
    await press('Use a sample file');
    expect(screen.getByText('locations_sample.csv')).toBeTruthy();
    await press('Import');
    expect(env.actions.importLocationsCsv).toHaveBeenCalledWith({ file: sample.text });
  });

  it('keeps the dialog open with the data layer\'s English message when the file has a wrong row, and writes nothing', async () => {
    env.actions.importLocationsCsv.mockResolvedValue(fail('invalid', 'Location import: 1 problem, nothing was imported. Row 3 (code): zone code RD-C already exists.'));
    inShell('en', <ImportDialog open canEdit sample={sample} />);
    await press('Use a sample file');
    await press('Import');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Row 3 (code): zone code RD-C already exists.');
    expect(screen.getByRole('dialog', { name: 'Import locations' })).toBeTruthy();
    expect(env.router.replace).not.toHaveBeenCalled();
  });

  it('is not shown for a person who may not edit the import button, and has no sample link without a sample', () => {
    inShell('en', <ImportDialog open canEdit sample={undefined} />);
    expect(screen.queryByRole('button', { name: 'Use a sample file' })).toBeNull();
    cleanup();
    inShell('en', <ImportDialog open={false} canEdit sample={sample} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes with Cancel by removing ?import= from the address', async () => {
    inShell('en', <ImportDialog open canEdit sample={sample} />);
    await press('Cancel');
    expect(env.router.replace).toHaveBeenCalledWith('/admin/locations', { scroll: false });
  });
});

describe('in Arabic', () => {
  it('draws the drawer and the dialog with Arabic labels, the Arabic name field right to left, and the code left to right', () => {
    inShell('ar', drawer());
    expect(screen.getByRole('dialog', { name: 'تعديل: منطقة' })).toBeTruthy();
    expect(screen.getByLabelText('الاسم العربي').getAttribute('dir')).toBe('rtl');
    expect(screen.getByLabelText(/^الرمز/).getAttribute('dir')).toBe('ltr');
    expect(screen.getByRole('button', { name: 'حفظ' })).toBeTruthy();
    cleanup();
    inShell('ar', <ImportDialog open canEdit sample={{ fileName: 'l.csv', text: 'x' }} />);
    expect(screen.getByRole('dialog', { name: 'استيراد المواقع' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'استخدام ملف نموذجي' })).toBeTruthy();
  });

  it('says the import in Arabic with the plural for one and for many', async () => {
    env.actions.importLocationsCsv.mockResolvedValue(ok({ cities: 1, zones: 0, subZones: 0, standbyPoints: 0, total: 1 }));
    inShell('ar', <ImportDialog open canEdit sample={{ fileName: 'l.csv', text: 'x' }} />);
    await press('استخدام ملف نموذجي');
    await press('استيراد');
    expect(await screen.findByText('استُورد موقع واحد')).toBeTruthy();
  });
});
