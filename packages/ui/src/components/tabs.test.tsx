// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '../provider';
import { Accordion } from './accordion';
import { Pagination } from './pagination';
import { Tabs } from './tabs';
import { Stepper, Timeline } from './timeline';

afterEach(cleanup);

describe('Tabs', () => {
  const items = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta', count: 2 },
  ];

  it('is a tablist of tabs with ids from the prefix, and arrow keys move the selection', () => {
    const onChange = vi.fn();
    render(<Tabs id="t" ariaLabel="Sections" items={items} value="a" onChange={onChange} />);
    const list = screen.getByRole('tablist', { name: 'Sections' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.id)).toEqual(['t-tab-a', 't-tab-b']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('tab', { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('follows the writing direction for arrow keys', () => {
    const onChange = vi.fn();
    render(
      <DesignSystemProvider locale="ar">
        <Tabs ariaLabel="x" items={items} value="a" onChange={onChange} />
      </DesignSystemProvider>,
    );
    fireEvent.keyDown(screen.getAllByRole('tab')[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Pagination', () => {
  it('is a navigation landmark with a summary and named buttons', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} pageCount={3} total={23} pageSize={10} onPageChange={onPageChange} />);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav.textContent).toContain('1 to 10 of 23');
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe('Timeline and Stepper', () => {
  it('lists events with title, time and description', () => {
    render(<Timeline items={[{ id: '1', title: 'Rule saved', time: '09:30', description: 'By the admin', tone: 'success' }]} />);
    const item = screen.getByRole('listitem');
    expect(item.textContent).toContain('Rule saved');
    expect(item.textContent).toContain('09:30');
  });

  it('lists steps, marks the current one and says which are completed', () => {
    const { container } = render(<Stepper steps={[{ label: 'Person' }, { label: 'Role' }, { label: 'Review' }]} current={1} />);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]?.textContent).toContain('Person (completed)');
    expect(steps[2]?.textContent).toBe('3Review');
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Role');
  });
});

describe('Accordion', () => {
  it('opens one section at a time in single mode', () => {
    render(
      <Accordion
        defaultValue={['a']}
        items={[
          { id: 'a', title: 'First', content: 'One' },
          { id: 'b', title: 'Second', content: 'Two' },
        ]}
      />,
    );
    const first = screen.getByRole('button', { name: /First/ });
    expect(first.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Second/ }));
    expect(screen.getByRole('button', { name: /Second/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /First/ }).getAttribute('aria-expanded')).toBe('false');
  });
});
