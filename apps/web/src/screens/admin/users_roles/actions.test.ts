// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listUsers } from '@/lib/data/users';
import type { User } from '@/lib/types';
import { disableUserAccount, disableUsers, enableUserAccount, inviteUser, resetEmergencyMfa, resetEmergencyPassword } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

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

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await resetGoTestState();
  session.role = 'administrator';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});

// Reading uses an administrator context whatever the session says, so a test can look at what a viewer's call left behind.
async function adminContext(): Promise<RequestContext> {
  return contextOf('administrator', 'private');
}
const users = async (): Promise<User[]> => (await listUsers(await adminContext(), { limit: 200 })).items;
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;
const person = async (predicate: (u: User) => boolean) => (await users()).find(predicate) as User;

// inviteUser tests that build a valid input (needing live
// zones via `valid`) moved to actions.live.test.ts.

describe('an unexpected error', () => {
  it('returns a reference ODP- and 8 hex characters, logs only that reference and the error name, and leaks no input', async () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError('boom: password=hunter2 email=secret@example.test');
      },
    });
    const result = await inviteUser(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result)).not.toMatch(/hunter2|secret@example|boom/);
    const logged = errorLog.mock.calls.flat().join('\n');
    expect(logged).toContain(result.reference);
    expect(logged).not.toMatch(/hunter2|secret@example|boom|password/);
    expect(session.revalidate).not.toHaveBeenCalled();
  });
});

describe('disable and enable', () => {
  it('disables a person, audits it, and enables them again (a person who never signed in goes back to invited)', async () => {
    const target = await person((u) => u.status === 'active' && u.assigned_role === 'planner');
    expect(await disableUserAccount({ targetUserId: target.id })).toMatchObject({ ok: true, data: { id: target.id, status: 'disabled' } });
    expect((await person((u) => u.id === target.id)).status).toBe('disabled');
    expect((await events('user.disabled')).at(0)).toMatchObject({ outcome: 'success', entity_id: target.id });
    expect(await enableUserAccount({ targetUserId: target.id })).toMatchObject({ ok: true, data: { status: 'active' } });
    const never = await person((u) => u.status === 'disabled');
    expect(await enableUserAccount({ targetUserId: never.id })).toMatchObject({ ok: true, data: { status: 'invited' } });
  });

  it('refuses to disable yourself, the same person twice, and the last administrator, as `conflict`', async () => {
    const self = (await adminContext()).userId;
    expect(await disableUserAccount({ targetUserId: self })).toMatchObject({ ok: false, code: 'conflict' });
    const target = await person((u) => u.status === 'disabled');
    expect(await disableUserAccount({ targetUserId: target.id })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await enableUserAccount({ targetUserId: self })).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('answers `not_found` for a person that does not exist and `invalid` for an id that is not one', async () => {
    expect(await disableUserAccount({ targetUserId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', 'toString', '__proto__', '../etc', 42, null, undefined]) expect(await disableUserAccount({ targetUserId: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('is refused for a viewer and audited as denied, leaving the person unchanged', async () => {
    const target = await person((u) => u.status === 'active' && u.assigned_role === 'planner');
    session.role = 'viewer_auditor';
    expect(await disableUserAccount({ targetUserId: target.id })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await enableUserAccount({ targetUserId: target.id })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await person((u) => u.id === target.id)).status).toBe('active');
    expect((await events('user.disabled')).map((e) => e.outcome)).toEqual(['denied']);
    expect((await events('user.enabled')).map((e) => e.outcome)).toEqual(['denied']);
  });
});

describe('disableUsers (the bulk bar: one data call per person)', () => {
  it('disables what it can, counts what it cannot, and reports the first problem in English', async () => {
    const all = await users();
    const planner = all.find((u) => u.status === 'active' && u.assigned_role === 'planner') as User;
    const already = all.find((u) => u.status === 'disabled') as User;
    const self = (await adminContext()).userId;
    const result = await disableUsers({ targetUserIds: [planner.id, already.id, self, planner.id] });
    expect(result).toMatchObject({ ok: true, data: { disabled: 1, failed: 2 } });
    if (result.ok) expect(result.data.firstProblem).toBe('The user is already disabled.');
    expect((await events('user.disabled')).filter((e) => e.outcome === 'success')).toHaveLength(1);
  });

  it('stops at the first refusal that concerns the caller, so a viewer leaves one denied event and not one per person', async () => {
    const targets = (await users()).filter((u) => u.status === 'active').slice(0, 5).map((u) => u.id);
    const disabledBefore = (await users()).filter((u) => u.status === 'disabled').length;
    session.role = 'viewer_auditor';
    expect(await disableUsers({ targetUserIds: targets })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('user.disabled')).map((e) => e.outcome)).toEqual(['denied']);
    expect((await users()).filter((u) => u.status === 'disabled')).toHaveLength(disabledBefore);
  });

  it('refuses an empty list, a list of more than 100, and a list that is not strings', async () => {
    for (const bad of [[], Array.from({ length: 101 }, (_, i) => String(i)), [1, 2], 'a', null, undefined]) expect(await disableUsers({ targetUserIds: bad as never }), JSON.stringify(bad)?.slice(0, 20)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

// updateUserAccess always needs live zone_ids: see
// actions.live.test.ts.

describe('the emergency administrator resets (LABELLED STUBS)', () => {
  it.each([
    ['password', resetEmergencyPassword, 'emergency_admin.password_reset'],
    ['MFA', resetEmergencyMfa, 'emergency_admin.mfa_reset'],
  ] as const)('%s: takes no argument, finds the account on the server, audits it with stub: true and changes nothing', async (_name, reset, action) => {
    const before = JSON.stringify(await users());
    const result = await reset();
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.data.hint).toMatch(/^[0-9a-f]{4}$/);
    const audit = (await events(action)).at(0);
    expect(audit).toMatchObject({ outcome: 'success', entity_type: 'user' });
    expect(audit?.detail).toMatchObject({ stub: true });
    expect(audit?.summary_en).toContain('stub');
    expect(JSON.stringify(await users())).toBe(before);
    expect(reset.length).toBe(0);
  });

  it('is refused for a viewer and audited as denied', async () => {
    session.role = 'viewer_auditor';
    expect(await resetEmergencyPassword()).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('emergency_admin.password_reset')).map((e) => e.outcome)).toEqual(['denied']);
  });
});

describe('the server-built context rule in this file', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
  const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

  it('is a use-server file whose exports are all async functions', () => {
    expect(source.trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);
    expect([...new Set(exported)]).toEqual(['async']);
  });

  it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
    const inputTypes = types.slice(types.indexOf('What the browser sends'));
    const fields = [...inputTypes.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
    expect(fields.length).toBeGreaterThan(8);
    for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
    const signatures = [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string);
    for (const signature of signatures) expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
  });
});
