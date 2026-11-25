// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { User } from '@/lib/types';
import { listAuditEvents } from './audit';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { createUser, disableUser, enableUser, getEffectiveAccess, getUser, listRoles, listUserDisplayNames, listUsers, previewEffectiveAccess, resetEmergencyAdminMfa, resetEmergencyAdminPassword, updateUser } from './users';
import { getDemoOptions } from './context';
import { buildContext, ctxFor, fixtureTenantId, expectJunkIdsInvalidLive, expectValid, expectValidItems, fixtureZoneIds, resetGoTestState, withTempDemoState } from './test-support';

withTempDemoState();

const admin = () => ctxFor('administrator');
const zones = () => fixtureZoneIds();
const fixtureUsers = () => fixtureRecords<User>('User');

describe('reading users and roles', () => {
  it('lists the fixture users and roles and validates against the contract', async () => {
    const ctx = admin();
    const users = await listUsers(ctx, { limit: 200 });
    expect(users.page.total).toBe(fixtureUsers().length);
    expectValid('UserList', users);
    expectValid('User', await getUser(ctx, users.items[0]!.id));
    const roles = await listRoles(ctx);
    expectValid('RoleList', roles);
    expect(roles.items).toHaveLength(7);
    expect((await listRoles(ctxFor('administrator', { installMode: 'shared' }))).items).toHaveLength(6);
    expect(roles.items.find((r) => r.id === 'dispatcher')).toMatchObject({ scope: 'assigned_zones' });
  });

  it('filters by search, status and role', async () => {
    const ctx = admin();
    expect((await listUsers(ctx, { assigned_role: 'planner', limit: 200 })).items.every((u) => u.assigned_role === 'planner')).toBe(true);
    expect((await listUsers(ctx, { status: 'disabled' })).items.every((u) => u.status === 'disabled')).toBe(true);
    expect((await listUsers(ctx, { q: 'nadia' })).items).toHaveLength(1);
  });

  it('is for the Administrator only', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      await expect(listUsers(ctxFor(role))).rejects.toThrow(ForbiddenError);
      await expect(listRoles(ctxFor(role))).rejects.toThrow(ForbiddenError);
    }
  });
});

describe('flow 6: create a user scoped to two zones, switch to them, check what they can do', () => {
  it('creates an invited user, previews and reads the effective access, and the switcher can build their context', async () => {
    const ctx = admin();
    const twoZones = [zones()[3] as string, zones()[7] as string];
    const user = await createUser(ctx, { email: 'sara.test@demo.example', display_name: 'Sara Test', assigned_role: 'dispatcher', zone_ids: twoZones });
    expectValid('User', user);
    expect(user).toMatchObject({ status: 'invited', assigned_role: 'dispatcher', zone_ids: twoZones, is_emergency_admin: false });
    const access = await getEffectiveAccess(ctx, user.id);
    expectValid('EffectiveAccess', access);
    expect(access).toMatchObject({ assigned_role: 'dispatcher', scope: 'assigned_zones', zone_ids: twoZones });
    expect(access.modules).toHaveLength(30);
    expect(access.modules.find((m) => m.module_id === 'ops.live_dispatch_board')).toMatchObject({ access: 'edit', can_approve: false });
    expect(access.modules.find((m) => m.module_id === 'admin.users_roles')?.access).toBe('none');
    const preview = await previewEffectiveAccess(ctx, { assigned_role: 'dispatch_supervisor', install_mode: 'shared', zone_ids: twoZones });
    expect(preview.scope).toBe('assigned_zones');
    expect(preview.modules.find((m) => m.module_id === 'admin.classification_rules')).toMatchObject({ access: 'view', can_approve: true });
    expect((await previewEffectiveAccess(ctx, { assigned_role: 'change_approver', install_mode: 'shared' })).modules.every((m) => m.access === 'none')).toBe(true);
    // "switch to them": the switcher builds a context from the role and the two zones, and lands on their user.
    const switched = buildContext({ role: 'dispatcher', installMode: 'private', zoneIds: twoZones }, [...fixtureUsers(), user].map((u) => ({ ...u, status: 'active' as const })), fixtureTenantId(), zones());
    expect(switched?.userId).toBe(user.id);
    expect(switched?.zoneScope).toEqual({ kind: 'assigned_zones', zoneIds: twoZones });
    expect((await getDemoOptions()).zones).toHaveLength(8);
  });

  it('gives a whole-install role no zones and refuses an assigned-zone role without any', async () => {
    const ctx = admin();
    expect((await createUser(ctx, { email: 'v@demo.example', display_name: 'V', assigned_role: 'viewer_auditor', zone_ids: [zones()[0] as string] })).zone_ids).toEqual([]);
    await expect(createUser(ctx, { email: 'p@demo.example', display_name: 'P', assigned_role: 'planner' })).rejects.toThrow(InvalidInputError);
    await expect(createUser(ctx, { email: 'p@demo.example', display_name: 'P', assigned_role: 'planner', zone_ids: ['00000000-0000-4000-8000-000000000000'] })).rejects.toThrow(InvalidInputError);
  });

  it('refuses a duplicate email, a bad email, a role that does not exist in the install mode, and unknown fields', async () => {
    const ctx = admin();
    await expect(createUser(ctx, { email: fixtureUsers()[0]!.email.toUpperCase(), display_name: 'Dup', assigned_role: 'administrator' })).rejects.toThrow(ConflictError);
    await expect(createUser(ctx, { email: 'not-an-email', display_name: 'X', assigned_role: 'administrator' })).rejects.toThrow(InvalidInputError);
    await expect(createUser(ctxFor('administrator', { installMode: 'dedicated' }), { email: 'ca@demo.example', display_name: 'CA', assigned_role: 'change_approver' })).rejects.toThrow(InvalidInputError);
    await expect(createUser(ctx, { email: 'a@demo.example', display_name: 'A', assigned_role: 'administrator', assigned_role_extra: 1 })).rejects.toThrow(InvalidInputError);
  });

  it('updates the role and zones, disables and enables, and audits each', async () => {
    const ctx = admin();
    const planner = fixtureUsers().find((u) => u.assigned_role === 'planner' && u.status === 'active')!;
    const updated = await updateUser(ctx, planner.id, { display_name: 'Reem Renamed', assigned_role: 'planner', zone_ids: [zones()[7] as string] });
    expect(updated).toMatchObject({ display_name: 'Reem Renamed', zone_ids: [zones()[7]] });
    expect((await disableUser(ctx, planner.id)).status).toBe('disabled');
    await expect(disableUser(ctx, planner.id)).rejects.toThrow(ConflictError);
    expect((await enableUser(ctx, planner.id)).status).toBe('active');
    await expect(enableUser(ctx, planner.id)).rejects.toThrow(ConflictError);
    const actions = (await listAuditEvents(ctx, { entity_id: planner.id })).items.map((e) => e.action).sort();
    expect(actions).toEqual(['user.disabled', 'user.enabled', 'user.updated']);
    expectValidItems('AuditEvent', (await listAuditEvents(ctx, { entity_id: planner.id })).items);
  });

  it('protects the last administrator and yourself', async () => {
    const ctx = admin();
    await expect(disableUser(ctx, ctx.userId)).rejects.toThrow(ConflictError);
    const others = fixtureUsers().filter((u) => u.assigned_role === 'administrator' && u.id !== ctx.userId);
    for (const other of others) await disableUser(ctx, other.id);
    await expect(updateUser(ctx, ctx.userId, { display_name: 'Nadia', assigned_role: 'planner', zone_ids: [zones()[0] as string] })).rejects.toThrow(ConflictError);
    const emergency = fixtureUsers().find((u) => u.is_emergency_admin)!;
    await expect(updateUser(ctx, emergency.id, { display_name: 'Emergency', assigned_role: 'viewer_auditor' })).rejects.toThrow(ConflictError);
  });

  it('refuses every other role, audits the denial, and never creates the user', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      await expect(createUser(ctxFor(role), { email: 'x@demo.example', display_name: 'X', assigned_role: 'administrator' })).rejects.toThrow(ForbiddenError);
    }
    expect((await listUsers(admin(), { q: 'x@customer' })).items).toHaveLength(0);
    expect((await listAuditEvents(admin(), { outcome: 'denied', action: 'user.created' })).items).toHaveLength(6);
    await expect(getUser(admin(), '00000000-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
  });

  it('persists between calls and resets to the fixtures', async () => {
    const ctx = admin();
    const user = await createUser(ctx, { email: 'persist@demo.example', display_name: 'Persist', assigned_role: 'viewer_auditor' });
    expect((await getUser(ctx, user.id)).email).toBe('persist@demo.example');
    await resetGoTestState();
    expect((await listUsers(ctx, { limit: 200 })).page.total).toBe(fixtureUsers().length);
  });
});

describe('emergency administrator resets', () => {
  it('resets the password and the MFA of the emergency account only, audited, with only a hint returned', async () => {
    const ctx = admin();
    const emergency = fixtureUsers().find((u) => u.is_emergency_admin)!;
    const password = await resetEmergencyAdminPassword(ctx, emergency.id);
    expectValid('EmergencyAdminResetResult', password);
    expect(password).toMatchObject({ reset_kind: 'password' });
    expect(password.temporary_secret_hint?.length).toBeLessThanOrEqual(8);
    expect(await resetEmergencyAdminMfa(ctx, emergency.id)).toMatchObject({ reset_kind: 'mfa' });
    await expect(resetEmergencyAdminMfa(ctx, ctx.userId)).rejects.toThrow(ConflictError);
    expect((await listAuditEvents(ctx, { entity_id: emergency.id })).items.map((e) => e.action).sort()).toEqual(['emergency_admin.mfa_reset', 'emergency_admin.password_reset']);
    // Review m7: nothing changes, and the audit trail says so.
    for (const event of (await listAuditEvents(ctx, { entity_id: emergency.id })).items) {
      expect(event.summary_en).toContain('(stub: nothing changed)');
      expect(event.detail).toMatchObject({ stub: true });
    }
    await expect(resetEmergencyAdminPassword(ctxFor('planner'), emergency.id)).rejects.toThrow(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------------------------
// DG1: the display names of people for a reader who may not list users
// ---------------------------------------------------------------------------------------------

describe('listUserDisplayNames (DG1)', () => {
  const ids = (n: number) => fixtureUsers().slice(0, n).map((u) => u.id);

  it('returns only the id, the display name and the role of each user asked for, in the order asked, and validates against the contract', async () => {
    const ctx = admin();
    const wanted = ids(3).reverse();
    const result = await listUserDisplayNames(ctx, wanted);
    expectValid('UserDisplayNames', result);
    expect(result.items.map((i) => i.id)).toEqual(wanted);
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual(['display_name', 'id', 'role']);
      expect(item.display_name).toBe(fixtureUsers().find((u) => u.id === item.id)?.display_name);
      expect(item.role).toBe(fixtureUsers().find((u) => u.id === item.id)?.assigned_role);
    }
    expect(JSON.stringify(result)).not.toMatch(/@|assigned_role|zone_ids|keycloak/);
  });

  it('is open to every role that exists in the install mode, including the ones that may not list users (Viewer, Change Approver, Dispatch Supervisor)', async () => {
    for (const role of ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      expect((await listUserDisplayNames(ctxFor(role), ids(2))).items, role).toHaveLength(2);
    }
    for (const role of ['viewer_auditor', 'dispatch_supervisor', 'change_approver'] as const) await expect(listUsers(ctxFor(role)), `${role} still cannot list users`).rejects.toThrow(ForbiddenError);
    // a role that does not exist in the install mode is refused
    await expect(listUserDisplayNames(ctxFor('change_approver', { installMode: 'shared' }), ids(1))).rejects.toThrow(ForbiddenError);
  });

  it('ignores the zone scope: a zone-scoped role sees the name of a person in another zone', async () => {
    const outsider = fixtureUsers().find((u) => u.assigned_role === 'administrator' && !u.is_emergency_admin)!;
    const dispatcher = ctxFor('dispatcher', { zones: [zones()[7] as string] });
    expect((await listUserDisplayNames(dispatcher, [outsider.id])).items).toEqual([{ id: outsider.id, display_name: outsider.display_name, role: 'administrator' }]);
  });

  it('leaves out ids that match no user, and asks each person once', async () => {
    const [first] = ids(1);
    const result = await listUserDisplayNames(admin(), [first as string, '00000000-0000-4000-8000-000000000000', first as string]);
    expect(result.items.map((i) => i.id)).toEqual([first]);
  });

  it('caps the number of ids: 1 to 100, and refuses anything that is not a list of ids', async () => {
    const ctx = admin();
    const many = Array.from({ length: 100 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect((await listUserDisplayNames(ctx, many)).items).toEqual([]);
    await expect(listUserDisplayNames(ctx, [...many, '00000000-0000-4000-8000-999999999999'])).rejects.toThrow(InvalidInputError);
    await expect(listUserDisplayNames(ctx, [])).rejects.toThrow(InvalidInputError);
    for (const bad of ['toString', null, undefined, 7, {}, 'a,b'] as unknown[]) await expect(listUserDisplayNames(ctx, bad as never), String(bad)).rejects.toThrow(InvalidInputError);
  });

  it('refuses a crafted id without touching the store', async () => {
    await expectJunkIdsInvalidLive((id) => listUserDisplayNames(admin(), [id]));
    const before = JSON.stringify((await listUsers(admin(), { limit: 200 })).items);
    const audits = (await listAuditEvents(admin(), { limit: 1 })).page.total;
    await listUserDisplayNames(admin(), ids(2));
    expect(JSON.stringify((await listUsers(admin(), { limit: 200 })).items)).toBe(before);
    expect((await listAuditEvents(admin(), { limit: 1 })).page.total).toBe(audits); // a read is not audited
  });

  it('checks the role before it looks at the ids: a role that may not call is forbidden whatever it sends', async () => {
    await expect(listUserDisplayNames(ctxFor('change_approver', { installMode: 'shared' }), 'not a list' as never)).rejects.toThrow(ForbiddenError);
  });
});
