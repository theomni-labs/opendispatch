// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { HeaderActions } from './HeaderActions';

const env = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/scenario-lab', useRouter: () => env.router }));

afterEach(() => {
  cleanup();
  for (const fn of Object.values(env.router)) fn.mockReset();
});

describe('Scenario Lab header actions', () => {
  it('disables New scenario when the person cannot edit, and it never acts', () => {
    inLocale('en', <HeaderActions canEdit={false} />, { module: 'ops.scenario_lab' });
    const button = screen.getByRole('button', { name: 'New scenario' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(env.router.push).not.toHaveBeenCalled();
  });

  it('keeps New scenario enabled for an editor', () => {
    inLocale('en', <HeaderActions canEdit />, { module: 'ops.scenario_lab' });
    const button = screen.getByRole('button', { name: 'New scenario' });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(button);
    expect(env.router.push).toHaveBeenCalledTimes(1);
  });
});
