// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentStatusLegend } from './AgentStatusLegend';
import { hasArabicIndicDigits, hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(cleanup);

describe('AgentStatusLegend', () => {
  it('shows each status with its count, in the order given', () => {
    const { container } = inLocale(
      'en',
      <AgentStatusLegend
        items={[
          { status: 'available', count: 12 },
          { status: 'en_route', count: 4 },
          { status: 'on_scene', count: 4 },
        ]}
      />,
    );
    const items = [...container.querySelectorAll('li')];
    expect(items.map((li) => li.textContent)).toEqual(['Available12', 'En route4', 'On scene4']);
  });

  it('hides the dot from assistive technology: the status name is written right next to it', () => {
    const { container } = inLocale('en', <AgentStatusLegend items={[{ status: 'available', count: 1 }]} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('[data-status="available"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders no items without failing (the empty state is the screen’s)', () => {
    const { container } = inLocale('en', <AgentStatusLegend items={[]} />);
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('writes the count in Western digits with the Arabic status name, on an Arabic page', () => {
    const { container } = inLocale(
      'ar',
      <AgentStatusLegend
        items={[
          { status: 'available', count: 12 },
          { status: 'offline', count: 1204 },
        ]}
      />,
    );
    expect(screen.getByText('متاح')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('1,204')).toBeTruthy();
    expect(hasArabicIndicDigits(readableText(container))).toBe(false);
    expect(hasLatinLetters(readableText(container))).toBe(false);
  });

  it('knows all six live statuses of the contract', () => {
    const items = (['available', 'assigned', 'en_route', 'on_scene', 'on_break', 'offline'] as const).map(
      (status) => ({ status, count: 1 }),
    );
    inLocale('en', <AgentStatusLegend items={items} />);
    for (const label of ['Available', 'Assigned', 'En route', 'On scene', 'On break', 'Offline']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});
