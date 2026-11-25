// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import { listUsers } from '@/lib/data/users';
import type { User } from '@/lib/types';
import { inviteUser, updateUserAccess } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Zones is api-backed: inviteUser (via `valid`) and
// updateUserAccess both need live zone ids.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

// The server actions against the real data layer and the committed fixtures, with the demo store in a temp folder. The session
// is the only thing stood in for: requireRequestContext returns the context of the role the test picks, exactly what a
// signed cookie would give.
const session = vi.hoisted(() => ({ role: 'administrator' as string | null, mode: 'private' as string, revalidate: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: session.revalidate }));
vi.mock('@/lib/data/context', async (original) => {
  const real = await original<typeof import('@/lib/data/context')>();
  return {
    ...real,
    requireRequestContext: async () => {
      if (session.role === null) throw new UnauthenticatedError();
      return contextOf(session.role as Role, session.mode as InstallMode);
    },
  };
});

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}


beforeEach(async () => {
  await resetGoTestState();
  session.role = 'administrator';
  session.mode = 'private';
  session.revalidate.mockReset();
});

// Reading uses an administrator context whatever the session says, so a test can look at what a viewer's call left behind.
async function adminContext(): Promise<RequestContext> {
  return contextOf('administrator', 'private');
}
const users = async (): Promise<User[]> => (await listUsers(await adminContext(), { limit: 200 })).items;
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;
const zoneIds = async (n: number) => (await listZones(await adminContext())).items.slice(0, n).map((z) => z.id);
const person = async (predicate: (u: User) => boolean) => (await users()).find(predicate) as User;
const valid = async () => ({ email: 'sara.test@demo.example', display_name: 'Sara Test', assigned_role: 'planner', zone_ids: await zoneIds(2) });

describe.skipIf(!hasApi)('inviteUser (live, real api and Postgres)', () => {
  it('creates an invited person with the role and zones, audits it, and refreshes the page in both languages', async () => {
    const input = await valid();
    const result = await inviteUser(input);
    expect(result).toMatchObject({ ok: true, data: { name: 'Sara Test', assignedRole: 'planner', status: 'invited' } });
    const created = await person((u) => u.email === input.email);
    expect(created).toMatchObject({ status: 'invited', assigned_role: 'planner', zone_ids: input.zone_ids });
    const audit = await events('user.created');
    expect(audit.at(0)).toMatchObject({ outcome: 'success', entity_id: created.id });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/users-roles', '/ar/admin/users-roles']);
  });

  it('is refused for a viewer, as `forbidden`, and audited as denied, and creates nobody', async () => {
    session.role = 'viewer_auditor';
    const before = (await users()).length;
    const result = await inviteUser(await valid());
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await users()).length).toBe(before);
    const audit = await events('user.created');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ outcome: 'denied', actor_type: 'user' });
    expect(session.revalidate).not.toHaveBeenCalled();
  });

  it('is refused for every role that is not an Administrator', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'change_approver'] as const) {
      session.role = role;
      expect(await inviteUser(await valid()), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events('user.created')).every((e) => e.outcome === 'denied')).toBe(true);
  });

  it('answers `unauthenticated` with no session, and touches nothing', async () => {
    session.role = null;
    expect(await inviteUser(await valid())).toMatchObject({ ok: false, code: 'unauthenticated' });
    expect(await events('user.created')).toHaveLength(0);
  });

  it.each([
    ['a bad e-mail address', { email: 'not-an-email' }, 'invalid'],
    ['an empty name', { display_name: '' }, 'invalid'],
    ['a role that does not exist', { assigned_role: 'root' }, 'invalid'],
    ['a zone-scoped role with no zone', { zone_ids: [] }, 'invalid'],
    ['an e-mail that is already used', { email: 'nadia.al.ghalani@demo.example' }, 'conflict'],
  ] as const)('refuses %s, with the data layer\'s English message, and creates nobody', async (_name, change, code) => {
    const before = (await users()).length;
    const result = await inviteUser({ ...(await valid()), ...change });
    expect(result).toMatchObject({ ok: false, code });
    if (!result.ok) expect(result.message).toMatch(/[A-Za-z]/);
    expect((await users()).length).toBe(before);
  });

  it('refuses Change Approver outside a private install', async () => {
    session.mode = 'shared';
    expect(await inviteUser({ ...(await valid()), assigned_role: 'change_approver', zone_ids: [] })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses input that is not an object, and never forwards a field it does not name', async () => {
    for (const bad of [null, undefined, 'x', 42, []]) expect(await inviteUser(bad as never), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
    // Extra keys are dropped, not forwarded: a browser cannot slip a role, customer or user id into the body.
    const result = await inviteUser({ ...(await valid()), role: 'administrator', customerId: 'someone-else', userId: 'x', extra: { admin: true } } as never);
    expect(result).toMatchObject({ ok: true, data: { assignedRole: 'planner' } });
    const created = await person((u) => u.email === 'sara.test@demo.example');
    expect(created.assigned_role).toBe('planner');
    expect(created.tenant_id).toBe((await adminContext()).customerId);
  });

  it('names the caller in the audit event, whatever the input claims', async () => {
    await inviteUser({ ...(await valid()), actor_user_id: 'forged' } as never);
    const audit = (await events('user.created'))[0];
    expect(audit?.actor_user_id).toBe((await adminContext()).userId);
  });
});

describe.skipIf(!hasApi)('updateUserAccess (live, real api and Postgres)', () => {
  it('changes name, role and zones, and audits from and to', async () => {
    const target = await person((u) => u.status === 'invited');
    const zones = await zoneIds(3);
    const result = await updateUserAccess({ targetUserId: target.id, display_name: 'Adel Renamed', assigned_role: 'dispatcher', zone_ids: zones });
    expect(result).toMatchObject({ ok: true, data: { name: 'Adel Renamed', assignedRole: 'dispatcher' } });
    expect(await person((u) => u.id === target.id)).toMatchObject({ display_name: 'Adel Renamed', assigned_role: 'dispatcher', zone_ids: zones });
    expect((await events('user.updated')).at(0)?.detail).toMatchObject({ from_role: 'planner', to_role: 'dispatcher' });
  });

  it('will not demote the last administrator or change the emergency administrator\'s role', async () => {
    const emergency = await person((u) => u.is_emergency_admin);
    expect(await updateUserAccess({ targetUserId: emergency.id, display_name: emergency.display_name, assigned_role: 'planner', zone_ids: await zoneIds(1) })).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('is refused for a viewer, and refuses a bad body', async () => {
    const target = await person((u) => u.status === 'invited');
    expect(await updateUserAccess({ targetUserId: target.id, display_name: 'X', assigned_role: 'planner', zone_ids: await zoneIds(1) })).toMatchObject({ ok: true });
    expect(await updateUserAccess({ targetUserId: target.id, display_name: '', assigned_role: 'planner', zone_ids: await zoneIds(1) })).toMatchObject({ ok: false, code: 'invalid' });
    session.role = 'viewer_auditor';
    expect(await updateUserAccess({ targetUserId: target.id, display_name: 'Y', assigned_role: 'planner', zone_ids: await zoneIds(1) })).toMatchObject({ ok: false, code: 'forbidden' });
  });
});
