// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale } from '../test-utils';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from './AdminTable';

const url = vi.hoisted(() => ({ pathname: '/admin/users-roles', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => url.pathname, useRouter: () => url.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(url.query) }));

const navigate = vi.fn();
beforeEach(() => {
  url.query = '';
});
afterEach(() => {
  cleanup();
  navigate.mockReset();
  url.router.replace.mockReset();
});

const columns: AdminTableColumn[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'email', header: 'Email', hideBelow: 'md' },
  { key: 'role', header: 'Role', sortable: true },
  { key: 'count', header: 'Users', align: 'end', sortable: true },
];
const rows: AdminTableRow[] = [
  { id: 'u3', cells: { name: <span translate="no">Zaid</span>, email: 'z@example.test', role: 'Planner', count: 3 }, sort: { name: 'Zaid', role: 'Planner', count: 3 } },
  { id: 'u1', cells: { name: <span translate="no">Amal</span>, email: 'a@example.test', role: 'Dispatcher', count: 12 }, sort: { name: 'Amal', role: 'Dispatcher', count: 12 } },
  { id: 'u2', cells: { name: <span translate="no">Maha</span>, email: 'm@example.test', role: 'Administrator', count: 7 }, sort: { name: 'Maha', role: 'Administrator', count: 7 }, tone: 'danger' },
];

function renderTable(ui: React.ReactNode, locale: 'en' | 'ar' = 'en') {
  return inLocale(locale, <DesignSystemProvider navigate={navigate} locale={locale}>{ui}</DesignSystemProvider>);
}
const bodyNames = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent);

describe('AdminTable: plain data in, a DataTable out', () => {
  it('renders the columns and the cells the server built, with a screen-reader caption', () => {
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'Users' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Name', 'Email', 'Role', 'Users']));
    expect(bodyNames()).toEqual(['Zaid', 'Amal', 'Maha']);
    expect(screen.getByText('z@example.test')).toBeTruthy();
    expect(document.querySelector('[translate="no"]')?.textContent).toBe('Zaid');
  });

  it('sorts at once when a header is pressed, and writes the sort to the address (page back to 1)', () => {
    url.query = 'page=2';
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} />);
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(bodyNames()).toEqual(['Amal', 'Maha', 'Zaid']);
    expect(url.router.replace).toHaveBeenLastCalledWith('/admin/users-roles?sort=name%3Aasc', { scroll: false });
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(bodyNames()).toEqual(['Zaid', 'Maha', 'Amal']);
    expect(url.router.replace).toHaveBeenLastCalledWith('/admin/users-roles?sort=name%3Adesc', { scroll: false });
  });

  it('sorts numbers as numbers, not as text', () => {
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} sort={{ key: 'count', direction: 'asc' }} />);
    expect(bodyNames()).toEqual(['Zaid', 'Maha', 'Amal']);
  });

  it('starts sorted by the sort the server validated', () => {
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} sort={{ key: 'role', direction: 'asc' }} />);
    expect(bodyNames()).toEqual(['Maha', 'Amal', 'Zaid']);
  });

  it('ignores a sort on a column that is not sortable or does not exist', () => {
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} sort={{ key: 'email', direction: 'asc' }} />);
    expect(bodyNames()).toEqual(['Zaid', 'Amal', 'Maha']);
    cleanup();
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} sort={{ key: 'salary', direction: 'desc' }} />);
    expect(bodyNames()).toEqual(['Zaid', 'Amal', 'Maha']);
  });

  it('follows a new sort from the server (Back)', () => {
    const { rerender } = renderTable(<AdminTable caption="Users" columns={columns} rows={rows} sort={{ key: 'name', direction: 'asc' }} />);
    expect(bodyNames()).toEqual(['Amal', 'Maha', 'Zaid']);
    rerender(<DesignSystemProvider navigate={navigate} locale="en"><AdminTable caption="Users" columns={columns} rows={rows} sort={{ key: 'name', direction: 'desc' }} /></DesignSystemProvider>);
    expect(bodyNames()).toEqual(['Zaid', 'Maha', 'Amal']);
  });
});

describe('AdminTable: rows open through the URL', () => {
  it('goes to ?id=<row id> on a row click, keeping the other parameters, through the provider\'s navigation', () => {
    url.query = 'tab=users&role=planner&page=2';
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} />);
    fireEvent.click(screen.getAllByRole('row')[2] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/admin/users-roles?tab=users&role=planner&page=2&id=u1');
  });

  it('goes to the row\'s own href when it has one', () => {
    renderTable(<AdminTable caption="Users" columns={columns} rows={[{ id: 'x', cells: { name: 'X' }, href: '/admin/audit-log?id=x' }]} />);
    fireEvent.click(screen.getAllByRole('row')[1] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/admin/audit-log?id=x');
  });

  it('can use another parameter, or none (rows are not links)', () => {
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} rowParam="rule" />);
    fireEvent.click(screen.getAllByRole('row')[1] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/admin/users-roles?rule=u3');
    navigate.mockReset();
    cleanup();
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} rowParam={false} />);
    fireEvent.click(screen.getAllByRole('row')[1] as HTMLElement);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not open a row when its checkbox is used', () => {
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} selectable />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Select row u3/ }));
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('AdminTable: selection, bulk actions, paging, empty', () => {
  it('shows the bulk bar with the selected count and the client parent\'s actions, which get the ids', () => {
    const run = vi.fn();
    renderTable(
      <AdminTable
        caption="Users"
        columns={columns}
        rows={rows}
        selectable
        bulkActions={(ids, clear) => (
          <button type="button" onClick={() => { run(ids); clear(); }}>Disable</button>
        )}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Select row u1/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Select row u2/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(run).toHaveBeenCalledWith(['u1', 'u2']);
  });

  it('pages at 25 by default, writes the page to the address and starts from the address', () => {
    const many: AdminTableRow[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, cells: { name: `Row ${String(i).padStart(2, '0')}` } }));
    renderTable(<AdminTable caption="Users" columns={[{ key: 'name', header: 'Name' }]} rows={many} />);
    expect(screen.getAllByRole('row')).toHaveLength(26);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(url.router.replace).toHaveBeenLastCalledWith('/admin/users-roles?page=2', { scroll: false });
    expect(screen.getAllByRole('row')).toHaveLength(6);
    cleanup();
    renderTable(<AdminTable caption="Users" columns={[{ key: 'name', header: 'Name' }]} rows={many} page={2} />);
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('shows the empty state the screen gives it, or the design system\'s default', () => {
    renderTable(<AdminTable caption="Users" columns={columns} rows={[]} emptyState={<p>No users match</p>} />);
    expect(screen.getByText('No users match')).toBeTruthy();
    cleanup();
    renderTable(<AdminTable caption="Users" columns={columns} rows={[]} />);
    expect(screen.getByText(/No records/)).toBeTruthy();
  });

  it('tints a row that has a tone', () => {
    renderTable(<AdminTable caption="Users" columns={columns} rows={rows} />);
    const tinted = screen.getAllByRole('row').filter((row) => /tone/i.test(row.className));
    expect(tinted).toHaveLength(1);
    expect(tinted[0]?.textContent).toContain('Maha');
  });
});

describe('AdminTable scroll cue', () => {
  const widths = { scrollWidth: 0, clientWidth: 0 };
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => widths.scrollWidth });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => widths.clientWidth });
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });
  const scroller = (container: Element) => container.querySelector('table')?.parentElement;

  it('marks the scrolling box when the table is wider than it', () => {
    widths.scrollWidth = 620;
    widths.clientWidth = 390;
    const { container } = renderTable(<AdminTable caption="Users" columns={columns} rows={rows} />);
    expect(scroller(container)?.getAttribute('data-cue')).toBe('more');
  });

  it('marks nothing to scroll when the table fits', () => {
    widths.scrollWidth = 390;
    widths.clientWidth = 390;
    const { container } = renderTable(<AdminTable caption="Users" columns={columns} rows={rows} />);
    expect(scroller(container)?.getAttribute('data-cue')).toBe('none');
  });
});

describe('AdminTable in Arabic', () => {
  it('draws with Arabic labels for the table\'s own text, and keeps names left to right', () => {
    const arColumns: AdminTableColumn[] = [{ key: 'name', header: 'الاسم', sortable: true }];
    const { container } = renderTable(<AdminTable caption="المستخدمون" columns={arColumns} rows={[{ id: 'a', cells: { name: <span translate="no">Nadia Al-Ghalani</span> }, sort: { name: 'Nadia' } }]} selectable />, 'ar');
    // The row checkbox's own aria-label is also translate="no" now (AdminTable always gives DataTable a rowLabel, and an
    // aria-label has no subtree of its own to scope), so the name is read from the visible span specifically, by tag.
    expect(hasLatinLetters(container.textContent ?? '', ['Nadia Al-Ghalani'])).toBe(false);
    expect(container.querySelector('span[translate="no"]')?.textContent).toBe('Nadia Al-Ghalani');
  });
});
