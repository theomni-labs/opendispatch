// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataSourceBadge } from './DataSourceBadge';
import { hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(cleanup);

/** The badges inside the group, in order: `data-badge` is the source, or MIXED for the "Mixed" badge. */
const badges = (root: Element) => [...root.querySelectorAll('[data-badge]')];

describe('DataSourceBadge', () => {
  it('shows one badge for one source, whatever the repeats', () => {
    const { container } = inLocale('en', <DataSourceBadge sources={['SYNTHETIC', 'SYNTHETIC', 'SYNTHETIC']} />);
    expect(screen.getByText('Synthetic')).toBeTruthy();
    expect(screen.queryByText('Mixed')).toBeNull();
    expect(badges(container)).toHaveLength(1);
    const group = screen.getByRole('group');
    expect(group.getAttribute('data-source')).toBe('SYNTHETIC');
    expect(group.getAttribute('aria-label')).toBe('Data source: Synthetic');
  });

  it('names the Imported sample and Live data, each with its own data-source', () => {
    const sample = inLocale('en', <DataSourceBadge sources={['IMPORTED']} />);
    expect(badges(sample.container).map((node) => node.textContent)).toEqual(['Imported sample']);
    expect(screen.getByRole('group').getAttribute('data-source')).toBe('IMPORTED');
    cleanup();
    const live = inLocale('en', <DataSourceBadge sources={['LIVE']} />);
    expect(badges(live.container).map((node) => node.textContent)).toEqual(['Live data']);
    expect(screen.getByRole('group').getAttribute('data-source')).toBe('LIVE');
  });

  it('says Mixed and names every source when sources differ', () => {
    const { container } = inLocale('en', <DataSourceBadge sources={['IMPORTED', 'SYNTHETIC', 'IMPORTED']} />);
    expect(screen.getByText('Mixed')).toBeTruthy();
    expect(screen.getByText('Synthetic')).toBeTruthy();
    expect(screen.getByText('Imported sample')).toBeTruthy();
    expect(screen.queryByText('Live data')).toBeNull();
    // Mixed badge plus one badge per distinct source, in a fixed order.
    expect(badges(container).map((node) => node.textContent)).toEqual(['Mixed', 'Synthetic', 'Imported sample']);
    expect(badges(container).map((node) => node.getAttribute('data-badge'))).toEqual(['MIXED', 'SYNTHETIC', 'IMPORTED']);
    const group = screen.getByRole('group');
    expect(group.getAttribute('data-source')).toBe('MIXED');
    expect(group.getAttribute('aria-label')).toBe('Data source: Mixed (Synthetic, Imported sample)');
  });

  it('says Mixed when told so, naming only the sources it knows', () => {
    const { container } = inLocale('en', <DataSourceBadge sources={['LIVE']} mixed />);
    expect(badges(container).map((node) => node.textContent)).toEqual(['Mixed', 'Live data']);
    expect(screen.getByRole('group').getAttribute('data-source')).toBe('MIXED');
  });

  it('lists the sources in one fixed order, however they arrive', () => {
    const { container } = inLocale('en', <DataSourceBadge sources={['LIVE', 'IMPORTED', 'SYNTHETIC']} />);
    expect(badges(container).map((node) => node.getAttribute('data-badge'))).toEqual(['MIXED', 'SYNTHETIC', 'IMPORTED', 'LIVE']);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Data source: Mixed (Synthetic, Imported sample, Live data)');
  });

  it('never leaves colour as the only signal: every badge has its name and an icon hidden from assistive technology', () => {
    const { container } = inLocale('en', <DataSourceBadge sources={['SYNTHETIC', 'LIVE']} />);
    for (const badge of badges(container)) {
      expect(badge.textContent?.trim()).not.toBe('');
      const icon = badge.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('renders Arabic labels and no English', () => {
    const { container } = inLocale('ar', <DataSourceBadge sources={['SYNTHETIC', 'LIVE']} />);
    expect(badges(container).map((node) => node.textContent)).toEqual(['مختلط', 'اصطناعية', 'بيانات مباشرة']);
    expect(hasLatinLetters(readableText(container))).toBe(false);
    cleanup();
    inLocale('ar', <DataSourceBadge sources={['IMPORTED']} />);
    expect(screen.getByText('عيّنة مستوردة')).toBeTruthy();
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('مصدر البيانات: عيّنة مستوردة');
  });

  it('says so when there are no sources, in both languages', () => {
    const { container } = inLocale('en', <DataSourceBadge sources={[]} />);
    expect(within(screen.getByRole('group')).getByText('No data')).toBeTruthy();
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Data source: No data');
    expect(screen.getByRole('group').hasAttribute('data-source')).toBe(false);
    expect(badges(container)).toHaveLength(0);
    cleanup();
    inLocale('ar', <DataSourceBadge sources={[]} />);
    expect(screen.getByText('لا توجد بيانات')).toBeTruthy();
  });
});
