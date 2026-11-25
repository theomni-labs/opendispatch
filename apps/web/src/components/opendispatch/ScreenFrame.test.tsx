// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ComponentPropsWithRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getModule, type ModuleAccessResult } from '@/lib/access';
import { ScreenEmpty, ScreenFrame } from './ScreenFrame';
import { hasLatinLetters, inLocale, readableText } from './test-utils';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/demo/actions', () => ({ setDemoSession: vi.fn(), signOutDemo: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: (props: ComponentPropsWithRef<'a'>) => <a {...props} />,
  usePathname: () => '/admin/users-roles',
  useRouter: () => router,
}));

afterEach(() => {
  cleanup();
  router.replace.mockReset();
  router.refresh.mockReset();
});

const def = getModule('admin.users_roles');
const EDIT: ModuleAccessResult = { access: 'edit', reduced: false };
const VIEW: ModuleAccessResult = { access: 'view', reduced: false };
const NONE: ModuleAccessResult = { access: 'none', reduced: false };
const REDUCED: ModuleAccessResult = { access: 'view', reduced: true };

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const hooks = (element: HTMLElement | null) => ({
  module: element?.getAttribute('data-module'),
  state: element?.getAttribute('data-state'),
  access: element?.getAttribute('data-access'),
  reduced: element?.getAttribute('data-reduced'),
});

// A module that writes its own state lines, as a module agent will in messages/admin/<module>/en.json.
const OWN_TEXT = {
  admin: { users_roles: { states: { empty: { title: 'No users yet', desc: 'Invited users appear here.' }, error: { desc: 'Users could not load.' } } } },
};

describe('ScreenFrame: the root and its hooks (the e2e specs read these four)', () => {
  it('carries the module id, the state, the access and whether the screen is reduced', () => {
    const { container } = inLocale('en', <ScreenFrame def={def} access={EDIT} homeHref="/admin/users-roles">content</ScreenFrame>);
    expect(hooks(root(container))).toEqual({ module: 'admin.users_roles', state: 'filled', access: 'edit', reduced: 'false' });
  });

  it('says view and reduced when the access model does (Updates in a shared install)', () => {
    const updates = getModule('admin.updates');
    const { container } = inLocale('en', <ScreenFrame def={updates} access={REDUCED} homeHref="/admin/updates">x</ScreenFrame>);
    expect(hooks(root(container))).toMatchObject({ module: 'admin.updates', access: 'view', reduced: 'true' });
  });
});

describe('ScreenFrame: the header', () => {
  it.each([
    ['en', 'Users and Roles'],
    ['ar', 'المستخدمون والأدوار'],
  ] as const)('shows the module title as the h1 and the data-source badge in %s', (locale, title) => {
    const { container } = inLocale(locale, <ScreenFrame def={def} access={EDIT} homeHref="/">content</ScreenFrame>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(title);
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(screen.queryByText(locale === 'en' ? 'View only' : 'عرض فقط')).toBeNull();
  });

  it('shows the source it is given, and says so when they are mixed', () => {
    const { container } = inLocale('en', <ScreenFrame def={def} access={EDIT} homeHref="/" sources={['SYNTHETIC', 'IMPORTED']}>x</ScreenFrame>);
    expect(container.querySelector('[data-badge="MIXED"]')).not.toBeNull();
  });

  it('marks a view-only screen and a reduced one, in the reader’s language', () => {
    inLocale('en', <ScreenFrame def={def} access={VIEW} homeHref="/">x</ScreenFrame>);
    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.queryByText('Reduced')).toBeNull();
    cleanup();
    inLocale('ar', <ScreenFrame def={def} access={REDUCED} homeHref="/">x</ScreenFrame>);
    expect(screen.getByText('عرض فقط')).toBeTruthy();
    expect(screen.getByText('صلاحيات محدودة')).toBeTruthy();
  });

  it('gives the screen its own badges, actions and tabs slots', () => {
    inLocale('en', <ScreenFrame def={def} access={EDIT} homeHref="/" meta={<span>Demo tag</span>} actions={<button type="button">Invite user</button>} tabs={<div role="tablist">tabs</div>}>x</ScreenFrame>);
    expect(screen.getByText('Demo tag')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite user' })).toBeTruthy();
    expect(screen.getByRole('tablist')).toBeTruthy();
  });
});

describe('ScreenFrame: the state switch', () => {
  it('renders the content only when filled: no content, so no data fetch, for the other states', () => {
    const Body = vi.fn(() => <p>the table</p>);
    for (const state of ['empty', 'loading', 'error', 'noaccess'] as const) {
      inLocale('en', <ScreenFrame def={def} access={EDIT} state={state} homeHref="/"><Body /></ScreenFrame>);
      cleanup();
    }
    expect(Body).not.toHaveBeenCalled();
    inLocale('en', <ScreenFrame def={def} access={EDIT} homeHref="/"><Body /></ScreenFrame>);
    expect(Body).toHaveBeenCalledTimes(1);
    expect(screen.getByText('the table')).toBeTruthy();
  });

  it.each([
    ['en', 'Nothing here yet'],
    ['ar', 'لا يوجد شيء بعد'],
  ] as const)('empty: the generic title when the module writes none, in %s', (locale, title) => {
    const { container } = inLocale(locale, <ScreenFrame def={def} access={EDIT} state="empty" homeHref="/">x</ScreenFrame>);
    expect(hooks(root(container)).state).toBe('empty');
    expect(screen.getByText(title)).toBeTruthy();
  });

  it('empty: uses the module’s own title and description, and its one action', () => {
    inLocale('en', <ScreenFrame def={def} access={EDIT} state="empty" homeHref="/" emptyAction={<button type="button">Invite user</button>}>x</ScreenFrame>, { messages: OWN_TEXT });
    expect(screen.getByText('No users yet')).toBeTruthy();
    expect(screen.getByText('Invited users appear here.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite user' })).toBeTruthy();
    expect(screen.queryByText('Nothing here yet')).toBeNull();
  });

  it('empty for real: an `isEmpty` screen shows the empty state and reports it', () => {
    const { container } = inLocale('en', <ScreenFrame def={def} access={EDIT} isEmpty homeHref="/" tabs={<div role="tablist">tabs</div>}><p>the table</p></ScreenFrame>);
    expect(hooks(root(container)).state).toBe('empty');
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(screen.queryByText('the table')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull(); // tabs belong to the content, as in the mockups
  });

  it('the state parameter wins over isEmpty, and shows the loading skeleton for it', () => {
    const { container } = inLocale('en', <ScreenFrame def={def} access={EDIT} isEmpty state="loading" homeHref="/">x</ScreenFrame>);
    expect(hooks(root(container)).state).toBe('loading');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getAllByText('Loading')).toHaveLength(1);
  });

  it('loading: keeps the header and its actions, and the shape is the module’s (a list for Users and Roles)', () => {
    const { container } = inLocale('en', <ScreenFrame def={def} access={EDIT} state="loading" homeHref="/" actions={<button type="button">Invite user</button>}>x</ScreenFrame>);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite user' })).toBeTruthy();
    expect(container.querySelector('[data-skeleton="list"]')).not.toBeNull();
  });

  it('loading: a placeholder page keeps the generic detail shape', () => {
    const { container } = inLocale('en', <ScreenFrame def={def} access={EDIT} state="loading" homeHref="/" placeholder>x</ScreenFrame>);
    expect(container.querySelector('[data-skeleton="detail"]')).not.toBeNull();
    expect(container.querySelector('[data-skeleton="list"]')).toBeNull();
  });

  it.each([
    ['en', 'Something went wrong', 'The data could not load.', 'Try again'],
    ['ar', 'حدث خطأ ما', 'تعذّر تحميل البيانات.', 'إعادة المحاولة'],
  ] as const)('error: announced, the generic line and a retry in %s', (locale, title, line, retry) => {
    const { container } = inLocale(locale, <ScreenFrame def={def} access={EDIT} state="error" homeHref="/">x</ScreenFrame>);
    expect(hooks(root(container)).state).toBe('error');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(title);
    expect(alert.textContent).toContain(line);
    fireEvent.click(screen.getByRole('button', { name: retry }));
    // The review retry leaves ?state=error and asks the server again.
    expect(router.replace).toHaveBeenCalledWith('/admin/users-roles');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('error: the module’s own line replaces the generic one', () => {
    inLocale('en', <ScreenFrame def={def} access={EDIT} state="error" homeHref="/">x</ScreenFrame>, { messages: OWN_TEXT });
    expect(screen.getByRole('alert').textContent).toContain('Users could not load.');
    expect(screen.queryByText('The data could not load.')).toBeNull();
  });

  it('no access: the panel, no badges, no actions, no content, whatever the state parameter says', () => {
    for (const state of [undefined, 'empty', 'loading', 'error'] as const) {
      const { container } = inLocale('en', <ScreenFrame def={def} access={NONE} state={state} homeHref="/admin/updates" actions={<button type="button">Invite user</button>}>the table</ScreenFrame>);
      expect(hooks(root(container)).state).toBe('noaccess');
      expect(hooks(root(container)).access).toBe('none');
      expect(screen.getByText('No access')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/admin/updates');
      expect(screen.queryByRole('button', { name: 'Invite user' })).toBeNull();
      expect(screen.queryByText('the table')).toBeNull();
      expect(container.querySelector('[data-badge]')).toBeNull();
      cleanup();
    }
  });

  it('no access can be asked for by the parameter, on a module the role can see', () => {
    const { container } = inLocale('en', <ScreenFrame def={def} access={EDIT} state="noaccess" homeHref="/">x</ScreenFrame>);
    expect(hooks(root(container))).toMatchObject({ state: 'noaccess', access: 'edit' });
  });

  it('has no English left in an Arabic page in any state', () => {
    for (const state of [undefined, 'empty', 'loading', 'error', 'noaccess'] as const) {
      const { container } = inLocale('ar', <ScreenFrame def={def} access={VIEW} state={state} homeHref="/" meta={null}>محتوى</ScreenFrame>);
      const text = readableText(container);
      expect(hasLatinLetters(text), `${state}: ${text}`).toBe(false);
      cleanup();
    }
  });
});

describe('ScreenFrame: overlays (drawers and dialogs)', () => {
  const drawer = <div role="dialog" aria-label="Create client" />;

  it('renders the overlays in the empty state, so the empty action can open its drawer', () => {
    const { container } = inLocale('en', <ScreenFrame def={def} access={EDIT} isEmpty homeHref="/" overlays={drawer}><p>the table</p></ScreenFrame>);
    expect(root(container)?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByRole('dialog', { name: 'Create client' })).toBeTruthy();
    expect(screen.queryByText('the table')).toBeNull();
  });

  it('renders them with the content, and for ?state=empty', () => {
    inLocale('en', <ScreenFrame def={def} access={EDIT} homeHref="/" overlays={drawer}><p>the table</p></ScreenFrame>);
    expect(screen.getByRole('dialog', { name: 'Create client' })).toBeTruthy();
    cleanup();
    inLocale('en', <ScreenFrame def={def} access={EDIT} state="empty" homeHref="/" overlays={drawer} />);
    expect(screen.getByRole('dialog', { name: 'Create client' })).toBeTruthy();
  });

  it.each(['loading', 'error', 'noaccess'] as const)('does not render them for %s', (state) => {
    inLocale('en', <ScreenFrame def={def} access={EDIT} state={state} homeHref="/" overlays={drawer} />);
    expect(screen.queryByRole('dialog', { name: 'Create client' })).toBeNull();
  });

  it('does not render them without access', () => {
    inLocale('en', <ScreenFrame def={def} access={NONE} isEmpty homeHref="/" overlays={drawer} />);
    expect(screen.queryByRole('dialog', { name: 'Create client' })).toBeNull();
  });
});

describe('ScreenEmpty', () => {
  it('is usable on its own, for a screen whose content found no rows', () => {
    inLocale('en', <ScreenEmpty moduleId="admin.users_roles" action={<button type="button">Invite user</button>} />, { messages: OWN_TEXT });
    expect(screen.getByText('No users yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite user' })).toBeTruthy();
  });
});
