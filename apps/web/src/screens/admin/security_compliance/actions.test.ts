// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { getSignInPolicy } from '@/lib/data/identity';
import { getSessionPolicy, getSupportAccessSetting, listControlEvidence, listSupportAccessEvents } from '@/lib/data/system';
import { endSupport, grantSupport, saveEvidence, saveSessionPolicy, saveSupportSetting, setMfaClaim } from './actions';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions against the real data layer and its seeds, with the demo store in a temp folder. The session is the only thing
// stood in for: requireRequestContext returns the context of the role and install mode the test picks.
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

async function adminContext(mode: InstallMode = 'private'): Promise<RequestContext> {
  return contextOf('administrator', mode);
}
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;
const controls = async () => (await listControlEvidence(await adminContext(), { limit: 50 })).items;
const control = async (ref: string) => (await controls()).find((c) => c.control_ref === ref) as NonNullable<Awaited<ReturnType<typeof controls>>[number]>;

const policy = (change: Record<string, unknown> = {}) => ({ session_length_minutes: 240, idle_timeout_minutes: 20, max_concurrent_sessions: 2, ...change });

describe('saveSessionPolicy', () => {
  it('saves the policy, audits from and to, and refreshes the page in both languages', async () => {
    expect(await saveSessionPolicy(policy())).toMatchObject({ ok: true, data: { lengthMinutes: 240, idleMinutes: 20, perPerson: 2 } });
    expect(await getSessionPolicy(await adminContext())).toEqual({ session_length_minutes: 240, idle_timeout_minutes: 20, max_concurrent_sessions: 2 });
    expect((await events('session_policy.updated')).at(0)?.detail).toMatchObject({ from: { session_length_minutes: 480 }, to: { session_length_minutes: 240 } });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/security-compliance', '/ar/admin/security-compliance']);
  });

  it.each([
    ['a session shorter than 5 minutes', { session_length_minutes: 4 }],
    ['a session longer than a day', { session_length_minutes: 1441 }],
    ['an idle timeout longer than the session', { session_length_minutes: 30, idle_timeout_minutes: 31 }],
    ['an idle timeout of 0', { idle_timeout_minutes: 0 }],
    ['an idle timeout over 240', { idle_timeout_minutes: 241 }],
    ['no sessions per person', { max_concurrent_sessions: 0 }],
    ['more than 20 sessions per person', { max_concurrent_sessions: 21 }],
    ['a fraction', { session_length_minutes: 60.5 }],
    ['text instead of a number', { session_length_minutes: '60' }],
  ])('refuses %s, as `invalid`, and changes nothing', async (_name, change) => {
    expect(await saveSessionPolicy(policy(change as Record<string, unknown>) as never)).toMatchObject({ ok: false, code: 'invalid' });
    expect((await getSessionPolicy(await adminContext())).session_length_minutes).toBe(480);
  });

  it('never forwards a field it does not name, and refuses input that is not an object', async () => {
    expect(await saveSessionPolicy({ ...policy(), role: 'x', customerId: 'y' } as never)).toMatchObject({ ok: true });
    for (const bad of [null, undefined, 'x', 42, []]) expect(await saveSessionPolicy(bad as never), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('is refused for every other role (audited as denied), and with no session as `unauthenticated`', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      session.role = role;
      expect(await saveSessionPolicy(policy()), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events('session_policy.updated')).every((e) => e.outcome === 'denied')).toBe(true);
    expect((await getSessionPolicy(await adminContext())).session_length_minutes).toBe(480);
    session.role = null;
    expect(await saveSessionPolicy(policy())).toMatchObject({ ok: false, code: 'unauthenticated' });
  });
});

describe('setMfaClaim (the Sign-in policy\'s claim, written from here)', () => {
  it('requires and stops requiring the claim, keeping the rest of the Sign-in policy as it is', async () => {
    const ctx = await adminContext();
    const before = await getSignInPolicy(ctx);
    expect(await setMfaClaim({ required: true })).toMatchObject({ ok: true, data: { required: true } });
    expect(await getSignInPolicy(ctx)).toEqual({ ...before, require_mfa_claim: true });
    expect(await setMfaClaim({ required: false })).toMatchObject({ ok: true, data: { required: false } });
    expect(await getSignInPolicy(ctx)).toEqual(before);
    expect((await events('sign_in_policy.updated')).map((e) => e.outcome)).toEqual(['success', 'success']);
  });

  it('refuses a value that is not a boolean', async () => {
    expect(await setMfaClaim({ required: 'yes' as never })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await setMfaClaim({} as never)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('is refused in a shared install (Sign-in and Identity is read only there) and audited as denied, changing nothing', async () => {
    session.mode = 'shared';
    expect(await setMfaClaim({ required: true })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await getSignInPolicy(await adminContext())).require_mfa_claim).toBe(false);
    expect((await events('sign_in_policy.updated')).map((e) => e.outcome)).toEqual(['denied']);
  });

  it('is refused for a role that cannot even read the policy, audited as denied', async () => {
    session.role = 'planner';
    expect(await setMfaClaim({ required: true })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('sign_in_policy.updated')).map((e) => e.outcome)).toEqual(['denied']);
  });
});

describe('saveEvidence (status and note; a file is never stored)', () => {
  it('sets the status and the note, stamps the review, and audits from and to', async () => {
    const target = await control('NCA-IR-01');
    expect(await saveEvidence({ controlId: target.id, status: 'in_progress', evidence_note: 'Waiting for the contact list.' })).toMatchObject({ ok: true, data: { ref: 'NCA-IR-01', status: 'in_progress' } });
    expect(await control('NCA-IR-01')).toMatchObject({ status: 'in_progress', evidence_note: 'Waiting for the contact list.' });
    expect((await control('NCA-IR-01')).reviewed_at).not.toBeNull();
    expect((await events('control_evidence.updated')).at(0)?.detail).toMatchObject({ framework: 'NCA', from: 'not_started', to: 'in_progress' });
  });

  it('refuses a status that does not exist, a note over 1,000 characters, and an unknown or malformed control', async () => {
    const target = await control('NCA-IR-01');
    expect(await saveEvidence({ controlId: target.id, status: 'done', evidence_note: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await saveEvidence({ controlId: target.id, status: 'evidenced', evidence_note: 'x'.repeat(1001) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await saveEvidence({ controlId: '00000000-0000-4000-8000-00000000dead', status: 'evidenced', evidence_note: '' })).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', 'toString', '__proto__', 42, null, undefined]) expect(await saveEvidence({ controlId: bad as never, status: 'evidenced', evidence_note: '' }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await control('NCA-IR-01')).toMatchObject({ status: 'not_started' });
  });

  it('takes no file: a crafted body cannot smuggle one in, and the stored control has no file field', async () => {
    const target = await control('NCA-IR-01');
    const result = await saveEvidence({ controlId: target.id, status: 'evidenced', evidence_note: 'x', file: 'data:application/pdf;base64,AAAA', files: ['a.pdf'], role: 'administrator' } as never);
    expect(result).toMatchObject({ ok: true });
    expect(Object.keys(await control('NCA-IR-01')).sort()).toEqual(Object.keys(target).sort());
    expect(JSON.stringify(await events('control_evidence.updated'))).not.toContain('AAAA');
  });

  it('is refused for other roles and audited as denied', async () => {
    const target = await control('NCA-IR-01');
    session.role = 'viewer_auditor';
    expect(await saveEvidence({ controlId: target.id, status: 'evidenced', evidence_note: '' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('control_evidence.updated')).map((e) => e.outcome)).toEqual(['denied']);
    expect(await control('NCA-IR-01')).toMatchObject({ status: 'not_started' });
  });
});

describe('support access: the setting, a grant, and ending it', () => {
  it('switches support access on and off and sets the longest grant, audited', async () => {
    expect(await saveSupportSetting({ enabled: true, max_duration_hours: 12 })).toMatchObject({ ok: true, data: { enabled: true, maxHours: 12 } });
    expect(await getSupportAccessSetting(await adminContext())).toEqual({ enabled: true, max_duration_hours: 12 });
    expect(await saveSupportSetting({ enabled: false, max_duration_hours: 12 })).toMatchObject({ ok: true, data: { enabled: false } });
    expect((await events('support_access.updated')).map((e) => e.outcome)).toEqual(['success', 'success']);
  });

  it.each([
    ['0 hours', { enabled: true, max_duration_hours: 0 }],
    ['more than 72 hours', { enabled: true, max_duration_hours: 73 }],
    ['a fraction', { enabled: true, max_duration_hours: 1.5 }],
    ['an "on" that is not a boolean', { enabled: 'yes', max_duration_hours: 8 }],
  ])('refuses %s, as `invalid`', async (_name, input) => {
    expect(await saveSupportSetting(input as never)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await getSupportAccessSetting(await adminContext())).toEqual({ enabled: false, max_duration_hours: 8 });
  });

  it('grants access for a limited time with a reason, only when the setting is on, and audits it', async () => {
    expect(await grantSupport({ hours: 2, reason: 'Check a feed.' })).toMatchObject({ ok: false, code: 'conflict' });
    await saveSupportSetting({ enabled: true, max_duration_hours: 8 });
    expect(await grantSupport({ hours: 3, reason: 'Check a feed.' })).toMatchObject({ ok: true, data: { hours: 3 } });
    const list = (await listSupportAccessEvents(await adminContext(), { limit: 10 })).items;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ reason: 'Check a feed.' });
    expect((await events('support_access.granted')).at(0)).toMatchObject({ outcome: 'success' });
  });

  it('refuses a grant longer than the setting, without a reason, or while one is open', async () => {
    await saveSupportSetting({ enabled: true, max_duration_hours: 4 });
    expect(await grantSupport({ hours: 5, reason: 'x' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grantSupport({ hours: 2, reason: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grantSupport({ hours: 2, reason: 'x'.repeat(501) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grantSupport({ hours: 0, reason: 'x' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await grantSupport({ hours: 2, reason: 'first' })).toMatchObject({ ok: true });
    expect(await grantSupport({ hours: 2, reason: 'second' })).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('ends an open grant now, and refuses one that has ended, one that does not exist and an id that is not one', async () => {
    await saveSupportSetting({ enabled: true, max_duration_hours: 8 });
    await grantSupport({ hours: 3, reason: 'Check a feed.' });
    const ctx = await adminContext();
    const open = (await listSupportAccessEvents(ctx, { limit: 10 })).items[0] as NonNullable<Awaited<ReturnType<typeof listSupportAccessEvents>>['items'][number]>;
    expect(await endSupport({ grantId: open.id })).toMatchObject({ ok: true, data: { ended: true } });
    expect(await endSupport({ grantId: open.id })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await endSupport({ grantId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', '__proto__', 42, null]) expect(await endSupport({ grantId: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
    expect((await events('support_access.ended')).at(0)).toMatchObject({ outcome: 'success', entity_id: open.id });
  });

  it('is refused for other roles and audited as denied', async () => {
    session.role = 'planner';
    expect(await saveSupportSetting({ enabled: true, max_duration_hours: 8 })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await grantSupport({ hours: 1, reason: 'x' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await endSupport({ grantId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'forbidden' });
    for (const action of ['support_access.updated', 'support_access.granted', 'support_access.ended']) expect((await events(action)).map((e) => e.outcome), action).toEqual(['denied']);
    expect((await getSupportAccessSetting(await adminContext())).enabled).toBe(false);
  });
});

describe('an unexpected error', () => {
  it('returns a reference ODP- and 8 hex characters, logs only that reference and the error name, and leaks no input', async () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError('boom: token=hunter2');
      },
    });
    const result = await saveSessionPolicy(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result)).not.toMatch(/hunter2|boom/);
    expect(errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|boom/);
  });
});

describe('the server-built context rule in this file', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
  const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

  it('is a use-server file whose exports are all async functions', () => {
    expect(source.trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported.length).toBe(6);
    expect([...new Set(exported)]).toEqual(['async']);
  });

  it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
    const inputTypes = types.slice(types.indexOf('What the browser sends'), types.indexOf('What the actions give back'));
    const fields = [...inputTypes.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
    expect(fields.length).toBeGreaterThan(8);
    for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
  });
});
