// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '../provider/provider';
import { DataTable, type Column } from './data-table';

interface Person {
  id: string;
  name: string;
  count: number;
}

const people: Person[] = [
  { id: 'p1', name: 'Zaid', count: 3 },
  { id: 'p2', name: 'Amal', count: 12 },
  { id: 'p3', name: 'Maha', count: 7 },
];

const columns: Column<Person>[] = [
  { key: 'name', header: 'Name', cell: (row) => row.name, sortValue: (row) => row.name },
  { key: 'count', header: 'Count', cell: (row) => row.count, sortValue: (row) => row.count, align: 'end' },
];

const firstCells = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent);

afterEach(cleanup);

describe('DataTable', () => {
  it('is a table named by its caption, with plain header text', () => {
    render(<DataTable caption="People" columns={columns} rows={people} getRowId={(row) => row.id} />);
    expect(screen.getByRole('table', { name: 'People' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Count']);
  });

  it('sorts from a header button and says so with aria-sort', () => {
    const onSortChange = vi.fn();
    render(<DataTable columns={columns} rows={people} getRowId={(row) => row.id} onSortChange={onSortChange} />);
    const header = screen.getAllByRole('columnheader')[1] as HTMLElement;
    expect(header.getAttribute('aria-sort')).toBe('none');
    fireEvent.click(within(header).getByRole('button', { name: 'Count' }));
    expect(firstCells()).toEqual(['Zaid', 'Maha', 'Amal']);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(within(header).getByRole('button', { name: 'Count' }));
    expect(firstCells()).toEqual(['Amal', 'Maha', 'Zaid']);
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'count', direction: 'desc' });
  });

  it('opens a row through the provider navigation, but not from its checkbox', () => {
    const navigate = vi.fn();
    render(
      <DesignSystemProvider navigate={navigate}>
        <DataTable columns={columns} rows={people} getRowId={(row) => row.id} rowHref={(row) => `/people/${row.id}`} selectable rowLabel={(row) => row.name} />
      </DesignSystemProvider>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row Amal' }));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Maha'));
    expect(navigate).toHaveBeenCalledWith('/people/p3');
  });

  it('shows a bulk bar with the count and hands the selected ids to the actions', () => {
    const run = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={people}
        getRowId={(row) => row.id}
        selectable
        bulkActions={(ids) => (
          <button type="button" onClick={() => run(ids)}>
            Export
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row p1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row p3' }));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Export' }));
    expect(run).toHaveBeenCalledWith(['p1', 'p3']);
  });

  it('pages, with a named next button and the range', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `r${String(i)}`, name: `Row ${String(i)}`, count: i }));
    const onPageChange = vi.fn();
    render(<DataTable columns={columns} rows={many} getRowId={(row) => row.id} pageSize={5} onPageChange={onPageChange} />);
    expect(screen.getAllByRole('row')).toHaveLength(6);
    expect(screen.getByText('1 to 5 of 12')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(firstCells()[0]).toBe('Row 5');
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
  });

  it('shows the default empty state, or the one it is given, and tints a toned row', () => {
    render(<DataTable columns={columns} rows={[]} getRowId={(row) => row.id} />);
    expect(screen.getByText('No records found')).toBeTruthy();
    cleanup();
    render(<DataTable columns={columns} rows={[]} getRowId={(row) => row.id} emptyState={<p>Nobody yet</p>} />);
    expect(screen.getByText('Nobody yet')).toBeTruthy();
    cleanup();
    const { container } = render(<DataTable columns={columns} rows={people} getRowId={(row) => row.id} rowTone={(row) => (row.id === 'p2' ? 'danger' : undefined)} />);
    expect(container.querySelector('tr[data-tone="danger"]')?.className).toMatch(/tone/i);
  });

  it('wraps footer cells in a row inside tfoot', () => {
    const { container } = render(
      <DataTable
        columns={columns}
        rows={people}
        getRowId={(row) => row.id}
        footer={
          <>
            <td>Total</td>
            <td data-align="end">22</td>
          </>
        }
      />,
    );
    expect(container.querySelector('tfoot tr')?.textContent).toBe('Total22');
  });
});
