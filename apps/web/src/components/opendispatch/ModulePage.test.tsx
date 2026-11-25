// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import type { ComponentPropsWithRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getModule, moduleAccess } from '@/lib/access';
import { ModulePage } from './ModulePage';
import { inLocale } from './test-utils';

vi.mock('@/lib/demo/actions', () => ({ setDemoSession: vi.fn(), signOutDemo: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: (props: ComponentPropsWithRef<'a'>) => <a {...props} />,
  usePathname: () => '/ops/forecast-explorer',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

// The placeholder of a module with no screen yet: a thin wrapper over ScreenFrame, whose four hooks and
// states the e2e specs (roles, screenshots) read.
describe('ModulePage (the placeholder)', () => {
  const ops = getModule('ops.forecast_explorer');
  const planner = moduleAccess('planner', ops.id, 'private');

  it('is the module title, the Synthetic badge and the empty state, with the four hooks', () => {
    const { container } = inLocale('en', <ModulePage def={ops} access={planner} state="empty" homeHref="/ops/field-planner" />);
    const root = container.querySelector('[data-module]');
    expect(root?.getAttribute('data-module')).toBe('ops.forecast_explorer');
    expect(root?.getAttribute('data-state')).toBe('empty');
    expect(root?.getAttribute('data-access')).toBe(planner.access);
    expect(root?.getAttribute('data-reduced')).toBe('false');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Forecast Explorer');
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
  });

  it.each(['loading', 'error'] as const)('shows the %s state', (state) => {
    const { container } = inLocale('en', <ModulePage def={ops} access={planner} state={state} homeHref="/" />);
    expect(container.querySelector('[data-module]')?.getAttribute('data-state')).toBe(state);
    if (state === 'loading') expect(screen.getAllByText('Loading')).toHaveLength(1);
    else expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('is the no-access panel, with no badge, for a role with no access', () => {
    const none = moduleAccess('dispatcher', 'admin.users_roles', 'private');
    const { container } = inLocale('en', <ModulePage def={getModule('admin.users_roles')} access={none} state="empty" homeHref="/ops/live-dispatch-board" />);
    expect(container.querySelector('[data-module]')?.getAttribute('data-state')).toBe('noaccess');
    expect(screen.getByText('No access')).toBeTruthy();
    expect(container.querySelector('[data-badge]')).toBeNull();
  });
});
