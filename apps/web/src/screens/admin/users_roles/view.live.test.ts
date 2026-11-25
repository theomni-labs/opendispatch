// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { INSTALL_MODES, ROLES, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { disableUser } from '@/lib/data/users';
import { loadUsersView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// loadUsersView always needs live zones, which
// every test here relies on.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// The server side of the screen against the real data layer and the committed fixtures (13 people, 8 zones, 3 cities).
beforeEach(async () => {
  await resetGoTestState();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');

describe.skipIf(!hasApi)('loadUsersView: the list (live, real api and Postgres)', () => {
  it('counts the people and the statuses over everyone, and lists everyone with no filter', async () => {
    const view = await loadUsersView(admin(), {});
    expect(view.total).toBe(13);
    expect(view.counts).toEqual({ active: 11, invited: 1, disabled: 1 });
    expect(view.rows).toHaveLength(13);
    expect(view.sources).toEqual(['SYNTHETIC']);
    expect(view.installMode).toBe('private');
    expect(view.hasEmergencyAdmin).toBe(true);
  });

  it('gives each row plain data: role, scope, zone codes (RD-C), never-signed-in as null, the emergency flag', async () => {
    const view = await loadUsersView(admin(), {});
    const fahad = view.rows.find((r) => r.name === 'Fahad Al-Musari');
    expect(fahad).toMatchObject({ assignedRole: 'dispatch_supervisor', scope: 'assigned_zones', zoneCodes: ['RD-C', 'RD-N', 'RD-E', 'RD-S', 'RD-W'], status: 'active', language: 'en' });
    expect(view.rows.find((r) => r.name === 'Adel Al-Hinari')).toMatchObject({ status: 'invited', lastSignIn: null, zoneCodes: ['RD-S'] });
    expect(view.rows.find((r) => r.name === 'Omar Al-Fadani')?.language).toBe('ar');
    expect(view.rows.filter((r) => r.emergency).map((r) => r.name)).toEqual(['Emergency Administrator']);
    expect(view.rows.find((r) => r.assignedRole === 'viewer_auditor')?.scope).toBe('whole_install');
    expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it can cross to the client
  });

  it('filters by search, role, status and zone code, each on the server', async () => {
    const c = admin();
    expect((await loadUsersView(c, { q: 'nadia' })).rows.map((r) => r.name)).toEqual(['Nadia Al-Ghalani']);
    expect((await loadUsersView(c, { q: 'CUSTOMER-SYNTHETIC' })).rows).toHaveLength(13);
    expect((await loadUsersView(c, { role: 'planner' })).rows.every((r) => r.assignedRole === 'planner')).toBe(true);
    expect((await loadUsersView(c, { status: 'disabled' })).rows.map((r) => r.name)).toEqual(['Ziyad Al-Khayani']);
    expect((await loadUsersView(c, { zone: 'RD-C' })).rows.map((r) => r.name)).toEqual(['Fahad Al-Musari', 'Omar Al-Fadani', 'Reem Al-Hinari']);
    expect((await loadUsersView(c, { role: 'planner', status: 'invited', zone: 'RD-S' })).rows.map((r) => r.name)).toEqual(['Adel Al-Hinari']);
    expect((await loadUsersView(c, { q: 'zzz-nobody' })).rows).toEqual([]);
  });

  it('keeps the counts and the role table over everyone while filtering, and shows no one for a zone code it does not know', async () => {
    const view = await loadUsersView(admin(), { q: 'nadia' });
    expect(view.total).toBe(13);
    expect(view.roleCounts).toMatchObject({ administrator: 2, dispatch_supervisor: 2, dispatcher: 3, planner: 3, remote_team_lead: 1, viewer_auditor: 1, change_approver: 1 });
    expect((await loadUsersView(admin(), { zone: 'XX-9' })).rows).toEqual([]);
  });

  it('offers the roles the install mode has, marking Change Approver unavailable outside a private install', async () => {
    const shared = await loadUsersView(ctxOf('administrator', 'shared'), {});
    expect(shared.roleOptions.map((o) => [o.role, o.availableHere])).toEqual(ROLES.map((role) => [role, role !== 'change_approver']));
    expect((await loadUsersView(admin(), {})).roleOptions.every((o) => o.availableHere)).toBe(true);
  });

  it('lists the zones of the caller with their code, city and name, in data order', async () => {
    const view = await loadUsersView(admin(), {});
    expect(view.zones.length).toBeGreaterThanOrEqual(8);
    expect(view.zones.find((z) => z.code === 'RD-C')).toMatchObject({ name: 'Riyadh Central', cityName: 'Riyadh' });
    expect(view.zones.find((z) => z.code === 'DM-C')).toMatchObject({ cityName: 'Dammam' });
  });
});

describe.skipIf(!hasApi)('loadUsersView: the open person (live, real api and Postgres)', () => {
  it('gives the person for a known id with what they can do in this install, and no notice', async () => {
    const c = admin();
    const target = (await loadUsersView(c, {})).rows.find((r) => r.name === 'Reem Al-Hinari');
    const view = await loadUsersView(c, { id: target?.id }, target?.id);
    expect(view.open?.user.name).toBe('Reem Al-Hinari');
    expect(view.unknownId).toBe(false);
    expect(view.open?.access.edit).toContain('ops.field_planner');
    expect(view.open?.access.view).toContain('ops.forecast_explorer');
    expect(view.open?.access.hidden).toBeGreaterThan(0);
  });

  it('opens a person even when the filters hide them', async () => {
    const c = admin();
    const target = (await loadUsersView(c, {})).rows.find((r) => r.name === 'Reem Al-Hinari');
    const view = await loadUsersView(c, { id: target?.id, q: 'nadia' }, target?.id);
    expect(view.rows.map((r) => r.name)).toEqual(['Nadia Al-Ghalani']);
    expect(view.open?.user.name).toBe('Reem Al-Hinari');
  });

  it('flags an id that is malformed or names nobody, and opens nothing (the screen says so above the list, never a 500)', async () => {
    const c = admin();
    expect((await loadUsersView(c, {}, 'not-a-uuid')).unknownId).toBe(true);
    const nobody = '00000000-0000-4000-8000-00000000dead';
    const view = await loadUsersView(c, { id: nobody }, nobody);
    expect(view.unknownId).toBe(true);
    expect(view.open).toBeUndefined();
    expect((await loadUsersView(c, {}, '')).unknownId).toBe(false);
    expect((await loadUsersView(c, {}, undefined)).unknownId).toBe(false);
  });

  it('says why a person cannot be disabled: yourself, or the last administrator', async () => {
    const c = admin();
    const view = await loadUsersView(c, {});
    expect(view.rows.find((r) => r.id === c.userId)?.disableBlock).toBe('self');
    expect(view.rows.filter((r) => r.disableBlock !== null).map((r) => r.disableBlock)).toEqual(['self']);
    // With the emergency account disabled, Nadia is the only administrator left. Seen by someone else, her row says so.
    const emergency = view.rows.find((r) => r.emergency);
    await disableUser(c, emergency?.id as string);
    const viewer = { ...c, userId: view.rows.find((r) => r.assignedRole === 'viewer_auditor')?.id as string };
    const after = await loadUsersView(viewer, {});
    expect(after.rows.find((r) => r.name === 'Nadia Al-Ghalani')?.disableBlock).toBe('lastAdmin');
  });
});

describe.skipIf(!hasApi)('loadUsersView: the matrices for the Roles tab, computed here for every install mode (live, real api and Postgres)', () => {
  it('has a matrix for each install mode, the roles that exist in it, and a cell for every role and module', async () => {
    const { matrices } = await loadUsersView(admin(), {});
    expect(Object.keys(matrices).sort()).toEqual([...INSTALL_MODES].sort());
    expect(matrices.private.roles).toEqual(ROLES);
    expect(matrices.shared.roles).toEqual(ROLES.filter((r) => r !== 'change_approver'));
    for (const mode of INSTALL_MODES) for (const role of ROLES) expect(Object.keys(matrices[mode].cells[role] ?? {})).toHaveLength(30);
  });

  it('agrees with the access model: the Administrator edits Users and Roles, the Supervisor approves rules, the Change Approver approves updates only in private', async () => {
    const { matrices } = await loadUsersView(admin(), {});
    expect(matrices.private.cells['administrator']?.['admin.users_roles']).toEqual({ access: 'edit', approve: false });
    expect(matrices.private.cells['dispatch_supervisor']?.['admin.classification_rules']).toEqual({ access: 'view', approve: true });
    expect(matrices.private.cells['change_approver']?.['admin.updates']).toEqual({ access: 'view', approve: true });
    expect(matrices.shared.cells['change_approver']?.['admin.updates']).toEqual({ access: 'none', approve: false });
    expect(matrices.shared.cells['administrator']?.['admin.sign_in_identity']?.access).toBe('view');
    expect(matrices.private.cells['administrator']?.['admin.sign_in_identity']?.access).toBe('edit');
    expect(matrices.dedicated.cells['administrator']?.['admin.updates']?.access).toBe('view');
  });

  it('summarises each role for the Effective access card, with approval kinds', async () => {
    const { matrices } = await loadUsersView(admin(), {});
    const supervisor = matrices.private.summary['dispatch_supervisor'];
    expect(supervisor?.approve).toContain('rule');
    expect(supervisor?.edit).toEqual(expect.arrayContaining(['ops.live_dispatch_board', 'ops.field_planner']));
    expect(matrices.private.summary['change_approver']?.approve).toEqual(['update']);
    expect(matrices.shared.summary['change_approver']?.approve).toEqual([]);
    const total = (s: { edit: readonly string[]; view: readonly string[]; hidden: number } | undefined) => (s?.edit.length ?? 0) + (s?.view.length ?? 0) + (s?.hidden ?? 0);
    for (const role of ROLES) expect(total(matrices.private.summary[role]), role).toBe(30);
  });
});
