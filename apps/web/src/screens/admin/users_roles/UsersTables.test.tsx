// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale } from '@/components/opendispatch/test-utils';
import { INSTALL_MODES, ROLES, scopeAppliesTo, type InstallMode, type Role } from '@/lib/access';
import type { ActionResult } from '@/lib/actions/types';
import type { AdminTableColumn, AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import type { BulkDisableResult, Matrices, MatrixCell, ModeMatrix, RoleOption } from './types';
import { RolesTab, UsersTable, type BulkPerson } from './UsersTables';

const env = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, disableUsers: vi.fn(), saveCsv: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/users-roles', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('./actions', () => ({ disableUsers: env.disableUsers }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saveCsv }));

beforeEach(() => {
  env.disableUsers.mockReset();
  env.saveCsv.mockReset();
});
afterEach(cleanup);

const columns: AdminTableColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'status', header: 'Status' },
];
const names = ['Nadia', 'Reem', 'Ziyad'];
const rows: AdminTableRow[] = names.map((name, i) => ({ id: `u${i + 1}`, cells: { name, status: i === 2 ? 'Disabled' : 'Active' } }));
const people: BulkPerson[] = names.map((name, i) => ({ id: `u${i + 1}`, status: i === 2 ? 'disabled' : 'active', exportCells: [name, i === 2 ? 'Disabled' : 'Active'] }));

const table = (canEdit = true) => (
  <DesignSystemProvider navigate={vi.fn()}>
    <UsersTable caption="Users" columns={columns} rows={rows} people={people} emptyState={<p>none</p>} canEdit={canEdit} exportHeader={['Name', 'Status']} exportFilename="users.csv" />
  </DesignSystemProvider>
);
const select = (name: RegExp) => fireEvent.click(screen.getByRole('checkbox', { name }));
const bar = () => screen.getByRole('region', { name: 'Bulk actions' });

describe('UsersTable: the bulk bar', () => {
  it('disables the selected people who are not already disabled, sending only their ids, and clears the selection', async () => {
    env.disableUsers.mockResolvedValue({ ok: true, data: { disabled: 2, failed: 0 } } satisfies ActionResult<BulkDisableResult>);
    inLocale('en', table(), { module: 'admin.users_roles' });
    select(/Select row u1/);
    select(/Select row u3/);
    select(/Select row u2/);
    await act(async () => {
      fireEvent.click(within(bar()).getByRole('button', { name: 'Disable' }));
    });
    expect(env.disableUsers).toHaveBeenCalledWith({ targetUserIds: ['u1', 'u2'] });
    expect(await screen.findByText('2 users disabled')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });

  it('says "1 user disabled" and the Arabic plural, and reports the people who could not be disabled with the server\'s message', async () => {
    env.disableUsers.mockResolvedValue({ ok: true, data: { disabled: 1, failed: 2, firstProblem: 'You cannot disable your own account.' } } satisfies ActionResult<BulkDisableResult>);
    inLocale('en', table(), { module: 'admin.users_roles' });
    select(/Select row u1/);
    await act(async () => {
      fireEvent.click(within(bar()).getByRole('button', { name: 'Disable' }));
    });
    expect(await screen.findByText('1 user disabled')).toBeTruthy();
    expect(screen.getByText(/Not disabled: 2\./)).toBeTruthy();
    expect(screen.getByText('You cannot disable your own account.').getAttribute('lang')).toBe('en');
    cleanup();
    env.disableUsers.mockResolvedValue({ ok: true, data: { disabled: 2, failed: 0 } });
    inLocale('ar', table(), { module: 'admin.users_roles' });
    select(/تحديد الصف u1/);
    await act(async () => {
      fireEvent.click(within(screen.getByRole('region', { name: 'إجراءات جماعية' })).getByRole('button', { name: 'تعطيل' }));
    });
    expect(await screen.findByText('عُطّل مستخدمان')).toBeTruthy();
  });

  it('calls nothing when only disabled people are selected', async () => {
    inLocale('en', table(), { module: 'admin.users_roles' });
    select(/Select row u3/);
    await act(async () => {
      fireEvent.click(within(bar()).getByRole('button', { name: 'Disable' }));
    });
    expect(env.disableUsers).not.toHaveBeenCalled();
  });

  it('shows a refusal as a toast, in the reader\'s language', async () => {
    env.disableUsers.mockResolvedValue({ ok: false, code: 'forbidden', message: 'Not allowed.' });
    inLocale('en', table(), { module: 'admin.users_roles' });
    select(/Select row u1/);
    await act(async () => {
      fireEvent.click(within(bar()).getByRole('button', { name: 'Disable' }));
    });
    expect(await screen.findByText('Your role cannot do that.')).toBeTruthy();
  });

  it('for a view-only role: Disable is disabled with the reason and never calls the action; Export still works', () => {
    inLocale('en', table(false), { module: 'admin.users_roles' });
    select(/Select row u1/);
    const disable = within(bar()).getByRole('button', { name: 'Disable' });
    expect(disable.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(disable);
    expect(env.disableUsers).not.toHaveBeenCalled();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Export' }));
    expect(env.saveCsv).toHaveBeenCalledWith('users.csv', { header: ['Name', 'Status'], rows: [['Nadia', 'Active']] });
  });

  it('exports only the selected rows and says so', async () => {
    inLocale('en', table(), { module: 'admin.users_roles' });
    select(/Select row u2/);
    select(/Select row u3/);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Export' }));
    expect(env.saveCsv).toHaveBeenCalledWith('users.csv', { header: ['Name', 'Status'], rows: [['Reem', 'Active'], ['Ziyad', 'Disabled']] });
    expect(await screen.findByText('Users exported')).toBeTruthy();
  });
});

// A small matrix: one Ops and one Admin module, so a test can read the cells.
const MODULES_IN_TEST = ['ops.live_dispatch_board', 'admin.users_roles', 'admin.updates'];
const cell = (role: Role, module: string, mode: InstallMode): MatrixCell => {
  if (role === 'change_approver' && mode !== 'private') return { access: 'none', approve: false };
  if (module === 'admin.users_roles') return { access: role === 'administrator' ? 'edit' : 'none', approve: false };
  if (module === 'admin.updates') return { access: role === 'administrator' ? 'edit' : role === 'change_approver' ? 'view' : 'none', approve: role === 'change_approver' };
  return { access: role === 'dispatcher' ? 'edit' : 'view', approve: false };
};
const modeMatrix = (mode: InstallMode): ModeMatrix => ({
  roles: ROLES.filter((r) => r !== 'change_approver' || mode === 'private'),
  cells: Object.fromEntries(ROLES.map((role) => [role, Object.fromEntries(MODULES_IN_TEST.map((m) => [m, cell(role, m, mode)]))])),
  summary: Object.fromEntries(ROLES.map((role) => [role, { edit: role === 'administrator' ? ['admin.users_roles'] : role === 'dispatcher' ? ['ops.live_dispatch_board'] : [], view: role === 'viewer_auditor' ? ['admin.audit_log'] : [], approve: role === 'change_approver' && mode === 'private' ? ['update'] : [], hidden: 20 }])),
});
const matrices = Object.fromEntries(INSTALL_MODES.map((mode) => [mode, modeMatrix(mode)])) as unknown as Matrices;
const roleOptions: RoleOption[] = ROLES.map((role) => ({ role, scope: scopeAppliesTo(role), availableHere: true }));
const counts = { administrator: 2, dispatch_supervisor: 2, dispatcher: 3, planner: 3, remote_team_lead: 1, viewer_auditor: 1, change_approver: 1 };
const roles = (mode: InstallMode = 'private') => (
  <DesignSystemProvider navigate={vi.fn()}>
    <RolesTab defaultMode={mode} matrices={matrices} roleOptions={roleOptions} roleCounts={counts} />
  </DesignSystemProvider>
);

describe('RolesTab', () => {
  it('opens on the install mode being administered, with the seven roles, their scope, count and what they can do', () => {
    inLocale('en', roles('dedicated'), { module: 'admin.users_roles' });
    expect((screen.getByRole('radio', { name: 'Dedicated' })).getAttribute('aria-checked')).toBe('true');
    const rows = screen.getAllByRole('row').filter((r) => r.querySelector('td'));
    const roleRows = rows.filter((r) => within(r).queryByRole('button', { name: /Administrator|Dispatch Supervisor|Dispatcher|Planner|Remote Team Lead|Viewer|Change Approver/ }));
    expect(roleRows).toHaveLength(7);
    const admin = roleRows[0] as HTMLElement;
    expect(admin.textContent).toContain('Whole install');
    expect(admin.textContent).toContain('2');
    expect(admin.textContent).toContain('Everything in the Admin Console');
  });

  it('shows the Administrator\'s effective access first and changes it when another role is chosen', () => {
    inLocale('en', roles(), { module: 'admin.users_roles' });
    const card = () => screen.getByRole('heading', { name: 'Effective access' }).closest('div') as HTMLElement;
    expect(card().textContent).toContain('Administrator');
    expect(card().textContent).toContain('Users and Roles');
    fireEvent.click(screen.getByRole('button', { name: /^Dispatcher$/ }));
    expect(card().textContent).toContain('Dispatcher');
    expect(card().textContent).toContain('Live Dispatch Board');
    expect(card().textContent).not.toContain('Users and Roles');
    expect(screen.getByRole('button', { name: /^Dispatcher$/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Administrator$/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows Change Approver with what it approves in a private install, and "Private installs only" in the others', () => {
    inLocale('en', roles(), { module: 'admin.users_roles' });
    fireEvent.click(screen.getByRole('button', { name: /Change Approver/ }));
    expect(screen.getByText('Can approve', { exact: false })).toBeTruthy();
    expect(screen.getByText('Updates', { selector: 'span' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Shared' }));
    expect(screen.getAllByText('Private installs only').length).toBeGreaterThan(0);
    expect(screen.queryByText('Can approve', { exact: false })).toBeNull();
  });

  it('changes the matrix with the install mode: the column of a role that does not exist is dimmed and its cells are dashes', () => {
    const { container } = inLocale('en', roles(), { module: 'admin.users_roles' });
    const matrix = container.querySelector('[data-matrix]') as HTMLElement;
    const columnOf = (name: string) => [...matrix.querySelectorAll('thead th')].findIndex((th) => th.textContent === name);
    const cellsOf = (name: string) => [...matrix.querySelectorAll('tbody tr:not([class*="group"]) td')].filter((_, i) => i % ROLES.length === columnOf(name) - 1);
    expect(cellsOf('Change Approver').map((c) => c.textContent)).toContain('View');
    fireEvent.click(screen.getByRole('radio', { name: 'Shared' }));
    expect(cellsOf('Change Approver').every((c) => c.textContent === '-')).toBe(true);
    expect(matrix.querySelector('thead th[class*="dim"]')?.textContent).toBe('Change Approver');
  });

  it('draws the matrix with the Ops and Admin groups and Edit, View and Approve cells', () => {
    const { container } = inLocale('en', roles(), { module: 'admin.users_roles' });
    const matrix = container.querySelector('[data-matrix]') as HTMLElement;
    expect([...matrix.querySelectorAll('tbody th[scope="colgroup"]')].map((th) => th.textContent)).toEqual(['Ops Console', 'Admin Console']);
    expect(within(matrix).getAllByText('Edit').length).toBeGreaterThan(0);
    expect(within(matrix).getAllByText('View').length).toBeGreaterThan(0);
    expect(within(matrix).getAllByText('Approve').length).toBe(1);
    expect(matrix.querySelectorAll('[data-selected]').length).toBeGreaterThan(0);
  });

  it('draws in Arabic with the role, module and console names translated', () => {
    const { container } = inLocale('ar', roles(), { module: 'admin.users_roles' });
    expect(hasLatinLetters(container.textContent ?? '', [])).toBe(false);
    expect(screen.getByRole('radiogroup', { name: 'نمط التثبيت' })).toBeTruthy();
  });
});
