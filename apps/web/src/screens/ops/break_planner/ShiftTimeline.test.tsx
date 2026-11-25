// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { ShiftTimeline } from './ShiftTimeline';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('zone=z1') }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/break-planner', useRouter: () => router }));

afterEach(() => {
  cleanup();
  for (const fn of Object.values(router)) fn.mockReset();
});

const props = {
  shifts: [
    { value: 'p-a', label: 'Day A 06:00–14:00' },
    { value: 'p-b', label: 'Day B 14:00–22:00' },
  ],
  shift: 'p-a',
  rows: [{ id: 'a1', name: 'Maha Al-Habati', blocks: [{ kind: 'break' as const, from: 11, to: 11.5, label: '11:00', selectable: true }] }],
  bands: [],
  startHour: 6,
  endHour: 14,
};

describe('Break Planner shift timeline', () => {
  it('a break block opens Adjust (?adjust=)', () => {
    inLocale('en', <ShiftTimeline {...props} />, { module: 'ops.break_planner' });
    fireEvent.click(screen.getByRole('button', { name: /^Adjust break, Maha Al-Habati/ }));
    expect(String(router.push.mock.calls.at(-1)?.[0])).toContain('adjust=a1');
  });

  it('a shift sub-tab sets ?shift=', () => {
    inLocale('ar', <ShiftTimeline {...props} />, { module: 'ops.break_planner' });
    fireEvent.click(screen.getByRole('radio', { name: 'Day B 14:00–22:00' }));
    const calls = [...router.push.mock.calls, ...router.replace.mock.calls].map((c) => String(c[0]));
    expect(calls.some((href) => href.includes('shift=p-b'))).toBe(true);
  });
});
