// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, type MenuEntry } from './menu';

afterEach(cleanup);

function setup(items: MenuEntry[]) {
  render(<Menu label="Row actions" trigger={<button type="button">Actions</button>} items={items} />);
  return screen.getByRole('button', { name: 'Actions' });
}

describe('Menu', () => {
  it('opens from its button and lists items, headings and separators', () => {
    const trigger = setup([{ type: 'heading', label: 'View only' }, { label: 'Edit' }, 'separator', { label: 'Delete', danger: true }]);
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Row actions' });
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit', 'Delete']);
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.getByText('View only')).toBeTruthy();
  });

  it('calls onSelect and closes', () => {
    const onSelect = vi.fn();
    const trigger = setup([{ label: 'Edit', onSelect }]);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not act on a disabled item', () => {
    const onSelect = vi.fn();
    const trigger = setup([{ label: 'Edit', onSelect, disabled: true }]);
    fireEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: 'Edit' });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders a link item as a link with the menuitem role', () => {
    setup([{ label: 'Open', href: '/cases/1' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'Open' }).getAttribute('href')).toBe('/cases/1');
  });

  it('moves with the arrow keys and closes on Escape', () => {
    const trigger = setup([{ label: 'One' }, { label: 'Two' }]);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'One' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Two' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'One' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('offers a radio group with the chosen value checked', () => {
    const onValueChange = vi.fn();
    const trigger = setup([
      { type: 'radio-group', heading: 'Sort', value: 'a', onValueChange, options: [{ value: 'a', label: 'Name' }, { value: 'b', label: 'Date' }] },
    ]);
    fireEvent.click(trigger);
    expect(screen.getByRole('group', { name: 'Sort' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Name' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Date' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('closes on a second click of the trigger', () => {
    const trigger = setup([{ label: 'One' }]);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
