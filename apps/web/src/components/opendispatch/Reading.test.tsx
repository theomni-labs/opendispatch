// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Reading, type ReadingItem } from './Reading';
import { hasArabicIndicDigits, hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(cleanup);

const EN_ITEMS: ReadingItem[] = [
  { label: 'From assignment', value: '49%', primary: true, illustrative: true },
  { label: 'From registration', value: '25%', illustrative: true },
];
const AR_ITEMS: ReadingItem[] = [
  { label: 'من الإسناد', value: '49%', primary: true, illustrative: true },
  { label: 'من التسجيل', value: '25%', illustrative: true },
];

describe('Reading', () => {
  it('shows the figure two ways, each with its label, in the order given', () => {
    const { container } = inLocale('en', <Reading items={EN_ITEMS} />);
    const terms = [...container.querySelectorAll('dt')].map((node) => node.textContent);
    expect(terms).toEqual(['From assignment', 'From registration']);
    const values = [...container.querySelectorAll('dd')].map((node) => node.textContent);
    expect(values).toContain('49%Illustrative');
    expect(values).toContain('25%Illustrative');
  });

  it('marks the primary reading, which the setting chose, and only that one', () => {
    const { container } = inLocale('en', <Reading items={EN_ITEMS} />);
    const primary = container.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    expect(within(primary[0] as HTMLElement).getByText('From assignment')).toBeTruthy();
    // With no note of its own, the primary reading says why it is highlighted.
    expect(within(primary[0] as HTMLElement).getByText('Primary, a setting')).toBeTruthy();
    expect(screen.getAllByText('Primary, a setting')).toHaveLength(1);
  });

  it('shows the note it is given and the Illustrative label only where asked', () => {
    inLocale(
      'en',
      <Reading
        items={[
          { label: 'From registration', value: '25%', note: '6 of 24' },
          { label: 'From assignment', value: '9:57', primary: true, note: 'Median' },
        ]}
      />,
    );
    expect(screen.getByText('6 of 24')).toBeTruthy();
    expect(screen.getByText('Median')).toBeTruthy();
    expect(screen.queryByText('Primary, a setting')).toBeNull();
    expect(screen.queryByText('Illustrative')).toBeNull();
  });

  it('keeps the figure left to right and untranslated, also on an Arabic page', () => {
    const { container } = inLocale('ar', <Reading items={AR_ITEMS} />);
    for (const value of container.querySelectorAll('dd > span[dir]')) {
      expect(value.getAttribute('dir')).toBe('ltr');
      expect(value.getAttribute('translate')).toBe('no');
    }
    expect(container.querySelectorAll('dd > span[dir]')).toHaveLength(2);
  });

  it('renders Arabic with the Arabic labels and no English, and Western digits', () => {
    const { container } = inLocale('ar', <Reading items={AR_ITEMS} />);
    expect(screen.getByText('الأساسي، بحسب الإعداد')).toBeTruthy();
    expect(screen.getAllByText('توضيحي')).toHaveLength(2);
    expect(hasLatinLetters(readableText(container))).toBe(false);
    expect(hasArabicIndicDigits(readableText(container))).toBe(false);
    expect(container.textContent).toContain('49%');
  });

  it('shows a unit after the figure, in the reader\u2019s language', () => {
    inLocale('en', <Reading items={[{ label: 'From assignment', value: '9:57', unit: 'min', primary: true }]} />);
    expect(screen.getByText('min')).toBeTruthy();
    cleanup();
    inLocale('ar', <Reading items={[{ label: 'من الإسناد', value: '9:57', unit: 'د' }]} />);
    expect(screen.getByText('د')).toBeTruthy();
  });

  it('has a compact form for a summary card: the primary note goes into a tooltip and to assistive technology', () => {
    const { container } = inLocale('en', <Reading compact items={[{ label: 'From assignment', value: '9:57', primary: true }, { label: 'From registration', value: '14:04' }]} />);
    const primary = container.querySelector('[data-primary]');
    expect(primary?.getAttribute('title')).toBe('Primary, a setting');
    // Still in the tree for a screen reader, but not a visible line of its own.
    expect(within(primary as HTMLElement).getByText('Primary, a setting').className).toMatch(/srOnly/);
    expect(container.querySelector('[data-primary] ~ div')?.hasAttribute('title')).toBe(false);
    cleanup();
    const full = inLocale('en', <Reading items={[{ label: 'From assignment', value: '9:57', primary: true }]} />);
    expect(full.container.querySelector('[data-primary]')?.hasAttribute('title')).toBe(false);
    expect(within(full.container.querySelector('[data-primary]') as HTMLElement).getByText('Primary, a setting').className).toMatch(/note/);
  });

  it('renders no items without failing (the empty state is the screen’s)', () => {
    const { container } = inLocale('en', <Reading items={[]} />);
    expect(container.querySelectorAll('dt')).toHaveLength(0);
  });
});
