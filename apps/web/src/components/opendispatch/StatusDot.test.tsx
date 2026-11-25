// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusDot, type StatusDotStatus } from './StatusDot';
import { hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(cleanup);

const EN: Record<Exclude<StatusDotStatus, 'neutral'>, string> = {
  available: 'Available',
  assigned: 'Assigned',
  en_route: 'En route',
  on_scene: 'On scene',
  on_break: 'On break',
  offline: 'Offline',
};
const AR: Record<Exclude<StatusDotStatus, 'neutral'>, string> = {
  available: 'متاح',
  assigned: 'مُسنَد',
  en_route: 'في الطريق',
  on_scene: 'في الموقع',
  on_break: 'في استراحة',
  offline: 'غير متصل',
};

describe('StatusDot', () => {
  it.each(Object.entries(EN))('names the %s status for assistive technology, so colour is not the only signal', (status, name) => {
    inLocale('en', <StatusDot status={status as keyof typeof EN} />);
    const dot = screen.getByRole('img', { name });
    expect(dot.getAttribute('data-status')).toBe(status);
  });

  it.each(Object.entries(AR))('names the %s status in Arabic', (status, name) => {
    const { container } = inLocale('ar', <StatusDot status={status as keyof typeof AR} />);
    expect(screen.getByRole('img', { name })).toBeTruthy();
    expect(hasLatinLetters(readableText(container))).toBe(false);
  });

  it('can be decorative when the status is written next to it', () => {
    const { container } = inLocale(
      'en',
      <span>
        <StatusDot status="available" decorative /> Available
      </span>,
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('[data-status]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes a label of its own, and a neutral dot with no label is decorative', () => {
    inLocale('en', <StatusDot status="offline" label="Feed down" />);
    expect(screen.getByRole('img', { name: 'Feed down' })).toBeTruthy();
    cleanup();
    const { container } = inLocale('en', <StatusDot status="neutral" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('[data-status="neutral"]')?.getAttribute('aria-hidden')).toBe('true');
    cleanup();
    inLocale('en', <StatusDot status="neutral" label="Unknown" />);
    expect(screen.getByRole('img', { name: 'Unknown' })).toBeTruthy();
  });

  it('knows all six live statuses of the contract', () => {
    expect(Object.keys(EN).sort()).toEqual(['assigned', 'available', 'en_route', 'offline', 'on_break', 'on_scene']);
  });
});
