// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale } from '@/components/opendispatch/test-utils';
import type { ActionResult } from '@/lib/actions/types';
import type { AccessSummary, Matrices, ModeMatrix, RoleOption, UserRow } from './types';
import { InviteButton, InviteDrawer, UserDrawer, UsersHeader } from './UsersForms';

// The client forms with the actions, the router and the demo action stood in for. What each test checks is what the browser
// sends to an action and what the person sees for each answer.
const env = vi.hoisted(() => ({
  query: '',
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  actions: {
    inviteUser: vi.fn(),
    updateUserAccess: vi.fn(),
    disableUserAccount: vi.fn(),
    enableUserAccount: vi.fn(),
    resetEmergencyPassword: vi.fn(),
    resetEmergencyMfa: vi.fn(),
  },
  setDemoSession: vi.fn(),
  saveCsv: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/users-roles', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ ...env.actions, disableUsers: vi.fn() }));
vi.mock('@/lib/demo/actions', () => ({ setDemoSession: env.setDemoSession, signOutDemo: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saveCsv }));

beforeEach(() => {
  env.query = '';
  for (const fn of Object.values(env.actions)) fn.mockReset();
  env.setDemoSession.mockReset();
  env.saveCsv.mockReset();
  env.router.push.mockReset();
  env.router.replace.mockReset();
});
afterEach(cleanup);

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (code: 'forbidden' | 'conflict' | 'invalid', message: string): ActionResult<never> => ({ ok: false, code, message });

const roleOptions = (privateOnly = false): RoleOption[] =>
  [
    ['administrator', 'whole_install'],
    ['dispatch_supervisor', 'assigned_zones'],
    ['dispatcher', 'assigned_zones'],
    ['planner', 'assigned_zones'],
    ['remote_team_lead', 'remote_pool'],
    ['viewer_auditor', 'whole_install'],
    ['change_approver', 'whole_install'],
  ].map(([role, scope]) => ({ role, scope, availableHere: !(privateOnly && role === 'change_approver') }) as RoleOption);

const zones = [
  { id: 'z-c', code: 'RD-C', name: 'Riyadh Central', cityId: 'c1', cityName: 'Riyadh' },
  { id: 'z-n', code: 'RD-N', name: 'Riyadh North', cityId: 'c1', cityName: 'Riyadh' },
  { id: 'z-j', code: 'JD-N', name: 'Jeddah North', cityId: 'c2', cityName: 'Jeddah' },
];

const summary = (edit: AccessSummary['edit'] = ['ops.live_dispatch_board']): AccessSummary => ({ edit, view: ['ops.forecast_explorer'], approve: [], hidden: 20 });
const matrixOf = (): ModeMatrix => ({ roles: ['administrator', 'dispatcher', 'viewer_auditor'], cells: {}, summary: { dispatcher: summary(), viewer_auditor: { edit: [], view: ['admin.audit_log'], approve: [], hidden: 27 }, administrator: summary(['admin.users_roles']) } });
const matrices: Matrices = { private: matrixOf(), dedicated: matrixOf(), shared: matrixOf() };

const person = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Reem Al-Hinari',
  email: 'reem.al.hinari@demo.example',
  assignedRole: 'planner',
  status: 'active',
  emergency: false,
  scope: 'assigned_zones',
  zoneIds: ['z-c', 'z-n'],
  zoneCodes: ['RD-C', 'RD-N'],
  lastSignIn: '2026-09-12T09:30:00+03:00',
  language: 'en',
  disableBlock: null,
  ...overrides,
});

const inShell = (locale: 'en' | 'ar', ui: React.ReactNode) => inLocale(locale, <DesignSystemProvider navigate={vi.fn()}>{ui}</DesignSystemProvider>, { module: 'admin.users_roles' });
const drawer = (props: Partial<Parameters<typeof UserDrawer>[0]> = {}) => (
  <UserDrawer user={person()} access={summary()} canEdit roleOptions={roleOptions()} zones={zones} installMode="private" hasEmergencyAdmin {...props} />
);
const invite = (props: Partial<Parameters<typeof InviteDrawer>[0]> = {}) => <InviteDrawer open canEdit roleOptions={roleOptions()} zones={zones} matrices={matrices} installMode="private" {...props} />;
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

describe('InviteButton and the header', () => {
  it('opens the invite drawer through the address with a push (Back closes it), and only when the person may edit', () => {
    inShell('en', <InviteButton canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite user' }));
    expect(env.router.push).toHaveBeenCalledWith('/admin/users-roles?new=1');
    cleanup();
    env.router.push.mockReset();
    inShell('en', <InviteButton canEdit={false} />);
    const disabled = screen.getByRole('button', { name: 'Invite user' });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(disabled);
    expect(env.router.push).not.toHaveBeenCalled();
  });

  it('shows the reason next to the button when asked (the empty state)', () => {
    inShell('en', <InviteButton canEdit={false} showReason variant="secondary" />);
    expect(screen.getByText('View only for this role')).toBeTruthy();
  });

  const header = (props: Partial<Parameters<typeof UsersHeader>[0]> = {}) => (
    <UsersHeader canEdit hasEmergencyAdmin exportFilename="users.csv" exportHeader={['Name', 'Email']} exportRows={[['Nadia', '=evil']]} {...props} />
  );

  it('resets the emergency password through the action with no argument, and the toast says Demo', async () => {
    env.actions.resetEmergencyPassword.mockResolvedValue(ok({ hint: '3f2a' }));
    inShell('en', header());
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Reset emergency password' }));
    });
    expect(env.actions.resetEmergencyPassword).toHaveBeenCalledWith();
    expect(await screen.findByText('Password reset')).toBeTruthy();
    expect(screen.getByText(/Temporary secret ends 3f2a\. Audited\. Demo\./)).toBeTruthy();
  });

  it('resets the authenticator app the same way', async () => {
    env.actions.resetEmergencyMfa.mockResolvedValue(ok({ hint: 'ab12' }));
    inShell('en', header());
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Reset emergency MFA' }));
    });
    expect(env.actions.resetEmergencyMfa).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Authenticator app reset')).toBeTruthy();
  });

  it('shows a refused reset as a toast and leaves the page as it was', async () => {
    env.actions.resetEmergencyPassword.mockResolvedValue(fail('forbidden', 'Not allowed.'));
    inShell('en', header());
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Reset emergency password' }));
    });
    expect(await screen.findByText('Your role cannot do that.')).toBeTruthy();
  });

  it('for a view-only role: the reset items are disabled and the menu says why; Export still works', () => {
    inShell('en', header({ canEdit: false }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Reset emergency password' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Reset emergency MFA' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Only an Administrator can reset')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export users' }));
    expect(env.saveCsv).toHaveBeenCalledWith('users.csv', { header: ['Name', 'Email'], rows: [['Nadia', '=evil']] });
  });

  it('disables the resets when there is no emergency account, and Export while the page shows a review state', () => {
    inShell('en', header({ hasEmergencyAdmin: false, exportRows: undefined }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Reset emergency password' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('There is no emergency account')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Export users' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('InviteDrawer: person, role and zones, review', () => {
  it('asks for a name and an e-mail before Next, saying what is missing', () => {
    inShell('en', invite());
    expect(screen.getByText('Enter a name and email')).toBeTruthy();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(next);
    expect(screen.getByLabelText(/Full name/)).toBeTruthy();
    type(/Full name/, 'Sara Test');
    type(/Email/, 'not-an-email');
    expect(screen.getByRole('button', { name: 'Next' }).getAttribute('aria-disabled')).toBe('true');
    type(/Email/, 'sara.test@demo.example');
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText('Enter a name and email')).toBeNull();
  });

  it('walks the three steps and sends exactly the person, the assigned role and the zones (nothing else)', async () => {
    env.actions.inviteUser.mockResolvedValue(ok({ id: 'new-user', name: 'Sara Test', assignedRole: 'dispatcher', status: 'invited' }));
    inShell('en', invite());
    type(/Full name/, '  Sara Test ');
    type(/Email/, ' sara.test@demo.example ');
    await press('Next');
    // step 2: a zone-scoped role needs a zone; the footer says so, once
    expect((screen.getByRole('radio', { name: /Dispatcher/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByText('Choose at least one zone')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Next' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'RD-C' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'JD-N' }));
    expect(screen.getByText('2 chosen')).toBeTruthy();
    await press('Next');
    // step 3: review
    expect(screen.getByText('Sara Test')).toBeTruthy();
    expect(screen.getByText('sara.test@demo.example')).toBeTruthy();
    expect(screen.getByText('Can edit', { exact: false })).toBeTruthy();
    await press('Send invite');
    expect(env.actions.inviteUser).toHaveBeenCalledTimes(1);
    const sent = env.actions.inviteUser.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toEqual({ email: 'sara.test@demo.example', display_name: 'Sara Test', assigned_role: 'dispatcher', zone_ids: ['z-c', 'z-j'] });
    expect(Object.keys(sent).some((key) => /^(role|customer|customerId|tenant|userId|installMode|ctx)$/i.test(key))).toBe(false);
    // success: a toast, the invite drawer closes and the new person's drawer opens (the address changes)
    expect(await screen.findByText('Invitation sent')).toBeTruthy();
    expect(screen.getByText(/Sara Test, Dispatcher/)).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalledWith('/admin/users-roles?id=new-user', { scroll: false });
  });

  it('needs no zone for a whole-install role: the zone picker is disabled and the invite sends an empty list', async () => {
    env.actions.inviteUser.mockResolvedValue(ok({ id: 'x', name: 'Aud', assignedRole: 'viewer_auditor', status: 'invited' }));
    inShell('en', invite());
    type(/Full name/, 'Aud Itor');
    type(/Email/, 'aud@demo.example');
    await press('Next');
    fireEvent.click(screen.getByRole('radio', { name: /Viewer \/ Auditor/ }));
    expect(screen.getByText('Not needed for this role')).toBeTruthy();
    for (const box of screen.getAllByRole('checkbox')) expect((box as HTMLInputElement).disabled).toBe(true);
    await press('Next');
    await press('Send invite');
    expect(env.actions.inviteUser.mock.calls[0]?.[0]).toMatchObject({ assigned_role: 'viewer_auditor', zone_ids: [] });
  });

  it('goes back a step and keeps what was typed', async () => {
    inShell('en', invite());
    type(/Full name/, 'Sara Test');
    type(/Email/, 'sara.test@demo.example');
    await press('Next');
    await press('Back');
    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).value).toBe('Sara Test');
  });

  it('shows Change Approver disabled, with its reason, outside a private install', async () => {
    inShell('en', invite({ roleOptions: roleOptions(true) }));
    type(/Full name/, 'Sara');
    type(/Email/, 'sara@demo.example');
    await press('Next');
    const radio = screen.getByRole('radio', { name: /Change Approver/ }) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(screen.getByText(/Private installs only/)).toBeTruthy();
  });

  it('keeps a refusal inside the drawer, with the server\'s English detail, and does not close it', async () => {
    env.actions.inviteUser.mockResolvedValue(fail('conflict', 'A user with sara@demo.example already exists.'));
    inShell('en', invite());
    type(/Full name/, 'Sara');
    type(/Email/, 'sara@demo.example');
    await press('Next');
    fireEvent.click(screen.getByRole('checkbox', { name: 'RD-C' }));
    await press('Next');
    await press('Send invite');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('That is not possible in its current state.');
    expect(alert.querySelector('[lang="en"]')?.textContent).toBe('A user with sara@demo.example already exists.');
    expect(env.router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Invite user' })).toBeTruthy();
  });

  it('for a view-only role: Send is disabled with the reason and never calls the action', async () => {
    inShell('en', invite({ canEdit: false }));
    type(/Full name/, 'Sara');
    type(/Email/, 'sara@demo.example');
    await press('Next');
    fireEvent.click(screen.getByRole('checkbox', { name: 'RD-C' }));
    await press('Next');
    const send = screen.getByRole('button', { name: 'Send invite' });
    expect(send.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(send);
    expect(env.actions.inviteUser).not.toHaveBeenCalled();
  });

  it('closes by removing ?new= from the address, and starts empty when it opens again', async () => {
    env.query = 'new=1';
    const { rerender } = inShell('en', invite());
    type(/Full name/, 'Sara');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(env.router.replace).toHaveBeenCalledWith('/admin/users-roles', { scroll: false });
    rerender(<DesignSystemProvider navigate={vi.fn()}>{invite({ open: false })}</DesignSystemProvider>);
    rerender(<DesignSystemProvider navigate={vi.fn()}>{invite()}</DesignSystemProvider>);
    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).value).toBe('');
  });

  it('reads in Arabic with no English outside the data', async () => {
    inShell('ar', invite());
    type(/الاسم الكامل/, 'Sara Test');
    type(/البريد/, 'sara@demo.example');
    await press('التالي');
    expect(hasLatinLetters(screen.getByRole('dialog').textContent ?? '', ['RD-C', 'RD-N', 'JD-N', 'Riyadh', 'Jeddah'])).toBe(false);
    expect(screen.getAllByText('اختر منطقة واحدة على الأقل')).toHaveLength(1);
    await press('رجوع');
    expect(screen.getByRole('dialog', { name: 'دعوة مستخدم' })).toBeTruthy();
  });
});

describe('UserDrawer: detail, edit, disable, enable', () => {
  it('shows the person with role, zones, last sign-in, language and what they can do', () => {
    inShell('en', drawer());
    const dialog = screen.getByRole('dialog', { name: 'Reem Al-Hinari' });
    expect(within(dialog).getByText('Active')).toBeTruthy();
    expect(within(dialog).getByText('Planner')).toBeTruthy();
    expect(within(dialog).getByText('RD-C')).toBeTruthy();
    expect(dialog.textContent).toMatch(/12 Sept 2026 09:30/);
    expect(within(dialog).getByText('English')).toBeTruthy();
    expect(within(dialog).getByText('Can edit', { exact: false })).toBeTruthy();
    expect(within(dialog).queryByText('Emergency administrator')).toBeNull();
  });

  it('shows Never for someone who has not signed in, and the person\'s own language', () => {
    inShell('ar', drawer({ user: person({ lastSignIn: null, language: 'ar' }) }));
    const dialog = screen.getByRole('dialog', { name: 'Reem Al-Hinari' });
    expect(dialog.textContent).toContain('لم يدخل بعد');
    expect(within(dialog).getByText('العربية')).toBeTruthy();
  });

  it('disables through a confirmation, sending only the target, and closes the dialog with a toast on success', async () => {
    env.actions.disableUserAccount.mockResolvedValue(ok({ id: person().id, name: 'Reem Al-Hinari', assignedRole: 'planner', status: 'disabled' }));
    inShell('en', drawer());
    await press('Disable user');
    const dialog = screen.getByRole('dialog', { name: 'Disable Reem Al-Hinari?' });
    expect(within(dialog).getByText('They cannot sign in. History stays.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Disable user' }));
    });
    expect(env.actions.disableUserAccount).toHaveBeenCalledWith({ targetUserId: person().id });
    expect(await screen.findByText('User disabled')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Disable Reem Al-Hinari?' })).toBeNull());
  });

  it('cancelling the confirmation calls nothing', async () => {
    inShell('en', drawer());
    await press('Disable user');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Disable Reem Al-Hinari?' })).getByRole('button', { name: 'Cancel' }));
    expect(env.actions.disableUserAccount).not.toHaveBeenCalled();
  });

  it('keeps a refusal inside the confirmation, with the data layer\'s message, and stays open', async () => {
    env.actions.disableUserAccount.mockResolvedValue(fail('conflict', 'The last active Administrator cannot be disabled.'));
    inShell('en', drawer());
    await press('Disable user');
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Disable Reem Al-Hinari?' })).getByRole('button', { name: 'Disable user' }));
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The last active Administrator cannot be disabled.');
    expect(screen.getByRole('dialog', { name: 'Disable Reem Al-Hinari?' })).toBeTruthy();
  });

  it('will not offer to disable yourself or the last administrator: disabled with the reason', () => {
    inShell('en', drawer({ user: person({ disableBlock: 'self' }) }));
    const button = screen.getByRole('button', { name: 'Disable user' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(screen.queryByRole('dialog', { name: /Disable Reem/ })).toBeNull();
    cleanup();
    inShell('en', drawer({ user: person({ disableBlock: 'lastAdmin' }) }));
    expect(screen.getByRole('button', { name: 'Disable user' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('enables a disabled person at once', async () => {
    env.actions.enableUserAccount.mockResolvedValue(ok({ id: person().id, name: 'Reem Al-Hinari', assignedRole: 'planner', status: 'active' }));
    inShell('en', drawer({ user: person({ status: 'disabled' }) }));
    expect(screen.queryByRole('button', { name: 'Disable user' })).toBeNull();
    await press('Enable user');
    expect(env.actions.enableUserAccount).toHaveBeenCalledWith({ targetUserId: person().id });
    expect(await screen.findByText('User enabled')).toBeTruthy();
  });

  it('edits name, role and zones and sends the target with assigned_role and zone_ids', async () => {
    env.actions.updateUserAccess.mockResolvedValue(ok({ id: person().id, name: 'Reem Renamed', assignedRole: 'dispatcher', status: 'active' }));
    inShell('en', drawer());
    await press('Edit');
    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).value).toBe('Reem Al-Hinari');
    expect((screen.getByRole('radio', { name: /Planner/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'RD-C' }) as HTMLInputElement).checked).toBe(true);
    type(/Full name/, 'Reem Renamed');
    fireEvent.click(screen.getByRole('radio', { name: /Dispatcher/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'JD-N' }));
    await press('Save');
    expect(env.actions.updateUserAccess).toHaveBeenCalledWith({ targetUserId: person().id, display_name: 'Reem Renamed', assigned_role: 'dispatcher', zone_ids: ['z-c', 'z-n', 'z-j'] });
    expect(await screen.findByText('User updated')).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText(/Full name/)).toBeNull());
  });

  it('cancels an edit without calling anything, and shows a refusal in the drawer', async () => {
    env.actions.updateUserAccess.mockResolvedValue(fail('invalid', 'User: a Dispatcher needs at least one zone.'));
    inShell('en', drawer());
    await press('Edit');
    await press('Cancel');
    expect(env.actions.updateUserAccess).not.toHaveBeenCalled();
    await press('Edit');
    await press('Save');
    expect((await screen.findByRole('alert')).textContent).toContain('a Dispatcher needs at least one zone');
    expect(screen.getByLabelText(/Full name/)).toBeTruthy();
  });

  it('will not save an edit that leaves a zone-scoped role with no zone, and says so at the picker', async () => {
    inShell('en', drawer());
    await press('Edit');
    fireEvent.click(screen.getByRole('checkbox', { name: 'RD-C' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'RD-N' }));
    expect(screen.getByRole('alert').textContent).toBe('Choose at least one zone');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(save);
    expect(env.actions.updateUserAccess).not.toHaveBeenCalled();
  });

  it('for a view-only role: Edit, Disable and Enable are disabled with the reason and call nothing', () => {
    inShell('en', drawer({ canEdit: false }));
    for (const name of ['Edit', 'Disable user']) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(button);
    }
    expect(screen.queryByRole('dialog', { name: /Disable Reem/ })).toBeNull();
    expect(env.actions.disableUserAccount).not.toHaveBeenCalled();
    cleanup();
    inShell('en', drawer({ canEdit: false, user: person({ status: 'disabled' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable user' }));
    expect(env.actions.enableUserAccount).not.toHaveBeenCalled();
  });

  it('renders nothing for no person', () => {
    inShell('en', drawer({ user: undefined }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('UserDrawer: the emergency administrator and "Switch to this user"', () => {
  const emergency = person({ id: '22222222-2222-4222-8222-222222222222', name: 'Emergency Administrator', assignedRole: 'administrator', scope: 'whole_install', zoneIds: [], zoneCodes: [], emergency: true });

  it('shows the resets with the Demo tag and calls the actions with no argument', async () => {
    env.actions.resetEmergencyPassword.mockResolvedValue(ok({ hint: '9c1d' }));
    inShell('en', drawer({ user: emergency }));
    const dialog = screen.getByRole('dialog', { name: 'Emergency Administrator' });
    expect(within(dialog).getByText('Emergency')).toBeTruthy();
    expect(dialog.querySelectorAll('[data-stub="demo"]').length).toBeGreaterThanOrEqual(2);
    await press('Reset password');
    expect(env.actions.resetEmergencyPassword).toHaveBeenCalledWith();
    expect(await screen.findByText('Password reset')).toBeTruthy();
  });

  it('for a view-only role: the resets are disabled with "Only an Administrator can reset"', () => {
    inShell('en', drawer({ user: emergency, canEdit: false }));
    expect(screen.getByRole('button', { name: 'Reset password' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Reset MFA' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Only an Administrator can reset')).toBeTruthy();
  });

  it('does not offer to switch to the emergency account, or to a person who is not active', () => {
    inShell('en', drawer({ user: emergency }));
    expect(screen.getByRole('button', { name: 'Switch to this user' }).getAttribute('aria-disabled')).toBe('true');
    cleanup();
    inShell('en', drawer({ user: person({ status: 'invited' }) }));
    expect(screen.getByRole('button', { name: 'Switch to this user' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('switches through the sanctioned demo action with the role, install mode and zones of that person, and the language', async () => {
    env.setDemoSession.mockImplementation(() => new Promise(() => undefined)); // an accepted choice redirects and never returns
    inShell('en', drawer());
    await press('Switch to this user');
    expect(env.setDemoSession).toHaveBeenCalledWith({ role: 'planner', installMode: 'private', zoneIds: ['z-c', 'z-n'] }, 'en');
    expect(await screen.findByText('Switched to Planner')).toBeTruthy();
  });

  it('sends no zones for a whole-install role, and shows the demo action\'s refusal', async () => {
    env.setDemoSession.mockResolvedValue({ ok: false, error: 'invalid' });
    inShell('ar', drawer({ user: person({ assignedRole: 'viewer_auditor', scope: 'whole_install', zoneIds: [], zoneCodes: [] }) }));
    await press('التبديل إلى هذا المستخدم');
    expect(env.setDemoSession).toHaveBeenCalledWith({ role: 'viewer_auditor', installMode: 'private', zoneIds: [] }, 'ar');
    expect((await screen.findByRole('alert')).textContent).toContain('تعذّر تطبيق الاختيار.');
  });

  it('marks the switch as Demo', () => {
    inShell('en', drawer());
    expect(screen.getByRole('dialog').querySelector('[data-stub="demo"]')).not.toBeNull();
  });
});
