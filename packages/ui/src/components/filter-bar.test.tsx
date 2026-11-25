// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterBar, FilterChip } from './filter-bar';

afterEach(cleanup);

describe('FilterBar', () => {
  it('has a search box that clears, and chips for the filters in force', () => {
    const onSearch = vi.fn();
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    render(
      <FilterBar
        search={{ value: 'nour', onChange: onSearch, placeholder: 'Search users' }}
        activeFilters={[{ label: 'Role: Planner', onRemove }]}
        onClearAll={onClearAll}
      />,
    );
    const box = screen.getByRole('searchbox', { name: 'Search users' }) as HTMLInputElement;
    expect(box.value).toBe('nour');
    fireEvent.change(box, { target: { value: 'nou' } });
    expect(onSearch).toHaveBeenLastCalledWith('nou');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onSearch).toHaveBeenLastCalledWith('');
    expect(screen.getByText('Filtered by')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter Role: Planner' }));
    expect(onRemove).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalled();
  });
});

describe('FilterChip', () => {
  it('opens a menu of choices and reports the one picked', () => {
    const onChange = vi.fn();
    render(<FilterChip label="Role" options={[{ value: 'planner', label: 'Planner' }, { value: 'agent', label: 'Agent' }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Role/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Planner' }));
    expect(onChange).toHaveBeenCalledWith('planner');
  });
});
