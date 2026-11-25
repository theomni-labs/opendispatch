// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '../provider/provider';
import { CommandPalette, normalizeSearchText } from './command-palette';

const items = [
  { id: 'a', label: 'Audit log', meta: 'Admin', href: '/admin/audit-log', keywords: 'سجل التدقيق' },
  { id: 'b', label: 'Live board', meta: 'Ops', href: '/ops/board' },
];

afterEach(cleanup);

describe('CommandPalette', () => {
  it('is a named combobox that lists matching links as options and announces the count', () => {
    render(<CommandPalette items={items} aria-label="Search modules" />);
    const box = screen.getByRole('combobox', { name: 'Search modules' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'audit' } });
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Audit logAdmin']);
    expect(options[0]?.getAttribute('href')).toBe('/admin/audit-log');
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('1 result');
  });

  it('matches the keywords, folds Arabic spelling, and opens the active result on Enter', () => {
    const navigate = vi.fn();
    render(
      <DesignSystemProvider navigate={navigate}>
        <CommandPalette items={items} />
      </DesignSystemProvider>,
    );
    const box = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'سجل' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('/admin/audit-log');
    expect(normalizeSearchText('  أحمد‏  ٣ ')).toBe('احمد 3');
  });

  it('says there are no results, and Escape closes the list', () => {
    render(<CommandPalette items={items} />);
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByRole('status').textContent).toBe('No results');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.getAttribute('aria-expanded')).toBe('false');
  });
});
