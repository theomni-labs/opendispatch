// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';

// loading.tsx and error.tsx of an Admin module page receive no props about the module, so they read the route parameter.
// Next's hooks are stood in for; the files are rendered as the framework would, inside the module's messages.
const mocks = vi.hoisted(() => ({ slug: 'users-roles' as string | undefined, router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => (mocks.slug === undefined ? {} : { module: mocks.slug }) }));
vi.mock('@/lib/demo/actions', () => ({ setDemoSession: vi.fn(), signOutDemo: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/users-roles', useRouter: () => mocks.router }));

afterEach(() => {
  cleanup();
  mocks.slug = 'users-roles';
  mocks.router.refresh.mockReset();
});

describe('admin/[module]/loading.tsx', () => {
  it.each([
    ['users-roles', 'list'],
    ['data-sources', 'cards'],
    ['localization', 'form'],
    ['updates', 'detail'],
  ])('draws the %s page as a %s while it loads, with a title bar and one announcement', async (slug, shape) => {
    mocks.slug = slug;
    const { default: Loading } = await import('@/app/[locale]/admin/[module]/loading');
    const { container } = inLocale('en', <Loading />);
    expect(container.querySelector(`[data-skeleton="${shape}"]`)).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getAllByText('Loading')).toHaveLength(1);
  });

  it('falls back to the generic shape when the route names no module', async () => {
    mocks.slug = undefined;
    const { default: Loading } = await import('@/app/[locale]/admin/[module]/loading');
    const { container } = inLocale('ar', <Loading />);
    expect(container.querySelector('[data-skeleton="detail"]')).not.toBeNull();
    expect(screen.getAllByText('جارٍ التحميل')).toHaveLength(1);
  });
});

describe('admin/[module]/error.tsx', () => {
  const own = { admin: { users_roles: { states: { error: { desc: 'Users could not load.' } } } } };

  it('shows the module’s own line, no thrown message, and a retry that asks the server again and resets the boundary', async () => {
    const { default: ModuleError } = await import('@/app/[locale]/admin/[module]/error');
    const reset = vi.fn();
    inLocale('en', <ModuleError error={Object.assign(new Error('secret stack detail'), { digest: 'abc' })} reset={reset} />, { messages: own });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Users could not load.');
    expect(document.body.textContent).not.toContain('secret stack detail');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('shows the generic line for a module whose message file has none, in Arabic too', async () => {
    mocks.slug = 'audit-log';
    const { default: ModuleError } = await import('@/app/[locale]/admin/[module]/error');
    inLocale('ar', <ModuleError error={new Error('x')} reset={vi.fn()} />, { messages: own });
    expect(screen.getByRole('alert').textContent).toContain('تعذّر تحميل البيانات.');
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
  });
});
