// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAuditEvents } from '@/lib/data/audit';
import { demoSignIn } from '@/lib/data/auth-session';
import { getRequestContext, requireRequestContext } from '@/lib/data/context';
import { buildContext, fixtureTenantId, fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { listRoleMappings } from '@/lib/data/identity';
import { DEMO_MODE_COOKIE, signDemoMode } from '@/lib/session/demo-session';

// The sign-in and sign-out actions run against the REAL data layer. Only what Next provides is replaced: the cookie jar
// (a Map), and the localized redirect (it throws, like Next's, with the target in the message). What is proved here: the
// session cookie is Go's for the data function's RESULT, the install mode comes from the mode cookie, no field of the input can carry a role, every outcome goes where the
// plan says, sign-out is audited once and before the cookie goes, and no password or code is stored, logged or returned.

const store = vi.hoisted(() => new Map<string, string>());
const jar = vi.hoisted(() => ({
  get: vi.fn((name: string) => (store.has(name) ? { name, value: store.get(name) as string } : undefined)),
  // the cookie options (third argument) are recorded by the mock and read through `jar.set.mock.calls`
  set: vi.fn((name: string, value: string, options?: Record<string, unknown>) => {
    store.set(name, value);
    return options;
  }),
  delete: vi.fn((name: string) => {
    store.delete(name);
  }),
}));
type Target = { href: string | { pathname: string; query?: Record<string, string> }; locale: string };
const redirectMock = vi.hoisted(() =>
  vi.fn((target: Target) => {
    const href = typeof target.href === 'string' ? target.href : `${target.href.pathname}?${new URLSearchParams(target.href.query).toString()}`;
    throw new Error(`NEXT_REDIRECT ${target.locale} ${href}`);
  }),
);

vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('@/i18n/navigation', () => ({ redirect: redirectMock }));

import { signInEmergency, signInMock, signOutDemo, type EmergencySignInInput, type MockSignInInput } from './actions';

const SECRET = process.env['DEMO_SESSION_SECRET'] ?? 'test-secret-with-at-least-16-chars';
const MOCK = 'mock-provider';
// Go holds the credentials; the runner reads the same DEMO_EMERGENCY_ADMIN_* values from the environment.
const PASSWORD = process.env['DEMO_EMERGENCY_ADMIN_PASSWORD'] ?? '';
const CODE = process.env['DEMO_EMERGENCY_ADMIN_TOTP'] ?? '';
const WRONG_CODE = CODE === '000000' ? '000001' : '000000';
const EMERGENCY_EMAIL = 'emergency.admin@demo.example';
const now = () => Math.floor(Date.now() / 1000);
const SESSION = 'opendispatch_session';

const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ['DEMO_SESSION_SECRET', 'DEMO_COOKIE_SECURE', 'OPENDISPATCH_API_URL'];

beforeEach(async () => {
  await resetGoTestState();
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env['DEMO_SESSION_SECRET'] = SECRET;
  delete process.env['DEMO_COOKIE_SECURE'];
  store.clear();
  jar.get.mockClear();
  jar.set.mockClear();
  // a test may replace what delete does (to see what was audited at that moment): every test starts with the plain one
  jar.delete.mockReset();
  jar.delete.mockImplementation((name: string) => {
    store.delete(name);
  });
  redirectMock.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

/** What the call did: the redirect it made (`NEXT_REDIRECT <locale> <href>`) or what it returned as JSON. */
async function outcome(call: () => Promise<unknown>): Promise<string> {
  try {
    return `returned ${JSON.stringify(await call())}`;
  } catch (error) {
    return (error as Error).message;
  }
}

const mock = (over: Partial<MockSignInInput> = {}): MockSignInInput => ({ provider_id: MOCK, subject: 'huda.test@demo.example', groups: ['opendispatch-administrators'], ...over });
const emergency = (over: Partial<EmergencySignInInput> = {}): EmergencySignInInput => ({ email: EMERGENCY_EMAIL, password: PASSWORD, ...over });

/** The jar's session, as Go reads it. */
async function sessionInJar() {
  const ctx = await getRequestContext();
  if (ctx === null) return null;
  return { role: ctx.role, installMode: ctx.installMode, zoneIds: ctx.zoneScope.kind === 'assigned_zones' ? ctx.zoneScope.zoneIds : [] };
}

/** The Administrator, to read audit and rules. */
async function admin() {
  const ctx = buildContext({ role: 'administrator', installMode: 'private', zoneIds: [] }, fixtureUsers(), fixtureTenantId());
  if (ctx === null) throw new Error('no administrator');
  return ctx;
}

const eventsOf = async (ctx: Awaited<ReturnType<typeof admin>>, action: string) => (await listAuditEvents(ctx, { action, limit: 200 })).items;

describe('signInMock: the session comes from the data function, never from the browser', () => {
  it('signs the cookie from the group rules and goes to the role landing', async () => {
    const ctx = await admin();
    const rule = (await listRoleMappings(ctx)).items.find((m) => m.group_match === 'opendispatch-planners-riyadh');
    expect(rule).toMatchObject({ assigned_role: 'planner' });
    expect(rule?.zone_ids.length).toBeGreaterThan(0);

    expect(await outcome(() => signInMock(mock({ groups: ['opendispatch-planners-riyadh'] }), 'en'))).toBe('NEXT_REDIRECT en /ops/field-planner');

    // Exactly one cookie is written: the session. The mode cookie is the start page's, sign-in leaves it alone.
    expect(jar.set).toHaveBeenCalledTimes(1);
    const [name, , options] = jar.set.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe(SESSION);
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false });
    // The role and the zones are the rule's, as the data function answered.
    expect(await sessionInJar()).toEqual({ role: 'planner', installMode: 'private', zoneIds: rule?.zone_ids });
    expect((await eventsOf(ctx, 'auth.mock_sign_in')).at(0)).toMatchObject({ outcome: 'success' });
  });

  it('gives the role the groups give, whoever the subject is (the role is recalculated at every sign-in)', async () => {
    // A dispatcher's e-mail with the administrators' group: the session is the Administrator's, the landing is the Administrator's.
    expect(await outcome(() => signInMock(mock({ subject: 'omar.al.fadani@demo.example', groups: ['opendispatch-administrators'] }), 'en'))).toBe('NEXT_REDIRECT en /admin/users-roles');
    expect(await sessionInJar()).toEqual({ role: 'administrator', installMode: 'private', zoneIds: [] });
  });

  it('keeps no zones for a role that has none, whatever the rule says', async () => {
    await outcome(() => signInMock(mock({ groups: ['opendispatch-auditors'] }), 'en'));
    expect(await sessionInJar()).toEqual({ role: 'viewer_auditor', installMode: 'private', zoneIds: [] });
  });

  it('uses the language of the page for the redirect, and English for one it does not know', async () => {
    expect(await outcome(() => signInMock(mock(), 'ar'))).toBe('NEXT_REDIRECT ar /admin/users-roles');
    expect(await outcome(() => signInMock(mock(), 'xx'))).toBe('NEXT_REDIRECT en /admin/users-roles');
  });

  it('takes the install mode from the signed mode cookie: private when there is none or it is not valid', async () => {
    expect(await outcome(() => signInMock(mock({ groups: ['opendispatch-change-approvers-team'] }), 'en'))).toBe('NEXT_REDIRECT en /admin/updates');
    expect((await sessionInJar())?.installMode).toBe('private');

    for (const [cookie, mode] of [
      [signDemoMode('dedicated', SECRET, now()), 'dedicated'],
      [signDemoMode('shared', SECRET, now()), 'shared'],
      ['garbage', 'private'],
      [signDemoMode('shared', 'another-secret-with-at-least-32-chars-0123', now()), 'private'],
      [signDemoMode('shared', SECRET, now() - 40 * 24 * 60 * 60), 'private'], // expired
    ] as const) {
      store.clear();
      store.set(DEMO_MODE_COOKIE, cookie);
      await outcome(() => signInMock(mock({ groups: ['opendispatch-administrators'] }), 'en'));
      expect((await sessionInJar())?.installMode, String(mode)).toBe(mode);
      // the mode cookie is left as it was
      expect(store.get(DEMO_MODE_COOKIE)).toBe(cookie);
    }
  });

  it('a Change Approver group means no role in a shared install: the Change Approver exists only in private installs', async () => {
    store.set(DEMO_MODE_COOKIE, signDemoMode('shared', SECRET, now()));
    expect(await outcome(() => signInMock(mock({ groups: ['opendispatch-change-approvers-team'] }), 'en'))).toBe('NEXT_REDIRECT en /sign-in/message/no-role');
    expect(await sessionInJar()).toBeNull();
  });
});

describe('signInMock: every outcome', () => {
  it('no matching group goes to the No role message and signs nobody in', async () => {
    const ctx = await admin();
    expect(await outcome(() => signInMock(mock({ groups: ['some-group-nobody-mapped'] }), 'en'))).toBe('NEXT_REDIRECT en /sign-in/message/no-role');
    expect(await outcome(() => signInMock(mock({ groups: [] }), 'ar'))).toBe('NEXT_REDIRECT ar /sign-in/message/no-role');
    expect(jar.set).not.toHaveBeenCalled();
    expect((await eventsOf(ctx, 'auth.mock_sign_in')).map((e) => e.outcome)).toEqual(['denied', 'denied']);
  });

  it('a provider that is not there (or is switched off) goes to the Refused message', async () => {
    const ctx = await admin();
    expect(await outcome(() => signInMock(mock({ provider_id: 'mock-provider-off' }), 'en'))).toBe('NEXT_REDIRECT en /sign-in/message/refused');
    expect(jar.set).not.toHaveBeenCalled();
    expect((await eventsOf(ctx, 'auth.mock_sign_in')).at(0)).toMatchObject({ outcome: 'failure' });
  });

  it('an account that is switched off goes to the Refused message too', async () => {
    // The fixtures have a disabled dispatcher.
    expect(await outcome(() => signInMock(mock({ subject: 'ziyad.al.khayani@demo.example', groups: ['opendispatch-dispatch-riyadh-core'] }), 'en'))).toBe('NEXT_REDIRECT en /sign-in/message/refused');
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('the scripted subject provider.error goes to the Went wrong message with the reference code', async () => {
    const ctx = await admin();
    const target = await outcome(() => signInMock(mock({ subject: 'provider.error' }), 'en'));
    expect(target).toMatch(/^NEXT_REDIRECT en \/sign-in\/message\/error\?ref=ODP-[0-9A-F]{8}$/);
    expect(jar.set).not.toHaveBeenCalled();
    // The code is the one the data layer put in the audit log's sign-in event? It is derived from the input, so the same input gives the same code.
    expect(await outcome(() => signInMock(mock({ subject: 'PROVIDER.ERROR' }), 'en'))).toMatch(/ref=ODP-[0-9A-F]{8}$/);
    expect((await eventsOf(ctx, 'auth.mock_sign_in')).at(0)).toMatchObject({ outcome: 'failure' });
  });

  it('refuses a value the data layer does not allow, and signs nobody in', async () => {
    for (const bad of [mock({ subject: '' }), mock({ subject: 'x'.repeat(129) }), mock({ groups: ['x'.repeat(257)] }), mock({ provider_id: 'x'.repeat(129) })]) {
      expect(await outcome(() => signInMock(bad, 'en'))).toBe('returned {"ok":false,"error":"invalid"}');
    }
    expect(jar.set).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('says "unavailable" and calls no data function when there is no usable session secret', async () => {
    const ctx = await admin();
    const before = (await eventsOf(ctx, 'auth.mock_sign_in')).length;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env['DEMO_SESSION_SECRET'];
    expect(await outcome(() => signInMock(mock(), 'en'))).toBe('returned {"ok":false,"error":"unavailable"}');
    expect(jar.set).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('DEMO_SESSION_SECRET'));
    process.env['DEMO_SESSION_SECRET'] = SECRET;
    expect(await eventsOf(ctx, 'auth.mock_sign_in')).toHaveLength(before);
  });

  it('an unexpected failure goes to the Went wrong message with a reference, and the server log names the error and not the input', async () => {
    // An API that cannot be reached: the sign-in call fails with a network error.
    process.env['OPENDISPATCH_API_URL'] = 'http://127.0.0.1:1';
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const target = await outcome(() => signInMock(mock({ subject: 'private.subject@demo.example' }), 'en'));
    expect(target).toMatch(/^NEXT_REDIRECT en \/sign-in\/message\/error\?ref=ODP-[0-9A-F]{8}$/);
    const reference = /ref=(ODP-[0-9A-F]{8})/.exec(target)?.[1] as string;
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain(reference);
    expect(line).not.toContain('private.subject');
    expect(jar.set).not.toHaveBeenCalled();
  });
});

describe('signInMock: the browser cannot send a role, customer, user, zone or install mode', () => {
  it('refuses a body with any other field, before the data layer is called: no cookie, no account, no audit event', async () => {
    const ctx = await admin();
    const before = (await eventsOf(ctx, 'auth.mock_sign_in')).length;
    const forged = [
      { role: 'administrator' },
      { assigned_role: 'administrator' },
      { installMode: 'shared' },
      { install_mode: 'shared' },
      { customerId: 'other-customer' },
      { tenant_id: 'other-customer' },
      { userId: 'someone' },
      { zoneIds: ['z'] },
      { zoneScope: { kind: 'whole_install' } },
      { extra: 'x' },
    ];
    for (const fields of forged) {
      // subject and groups of a planner: what the person "types". The forged field asks for more.
      const body = { ...mock({ subject: 'forger@demo.example', groups: ['opendispatch-planners-riyadh'] }), ...fields };
      expect(await outcome(() => signInMock(body as never, 'en')), JSON.stringify(fields)).toBe('returned {"ok":false,"error":"invalid"}');
    }
    expect(jar.set).not.toHaveBeenCalled();
    expect(await eventsOf(ctx, 'auth.mock_sign_in')).toHaveLength(before);
  });

  it('refuses input that is not the three typed fields', async () => {
    for (const bad of [null, undefined, 'administrator', 42, [], {}, { provider_id: MOCK, subject: 'a' }, { provider_id: MOCK, groups: [] }, mock({ groups: 'opendispatch-administrators' as never }), mock({ groups: [1 as never] }), mock({ subject: 5 as never }), mock({ provider_id: null as never }), mock({ groups: Array.from({ length: 65 }, (_, i) => `g${i}`) })]) {
      expect(await outcome(() => signInMock(bad as never, 'en')), JSON.stringify(bad)).toBe('returned {"ok":false,"error":"invalid"}');
    }
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('the cookie role equals what the data function answered: a session cannot be asked for', async () => {
    // Whatever the person types, the session is the rule's. Typing "role" is refused (above); typing a role name as a group is only a group.
    await outcome(() => signInMock(mock({ subject: 'administrator', groups: ['administrator'] }), 'en'));
    expect(jar.set).not.toHaveBeenCalled();
    await outcome(() => signInMock(mock({ subject: 'x@demo.example', groups: ['opendispatch-remote-team-leads'] }), 'en'));
    expect(await sessionInJar()).toEqual({ role: 'remote_team_lead', installMode: 'private', zoneIds: [] });
  });
});

describe('signInEmergency', () => {
  it('asks for the code when the password is right, without a session', async () => {
    expect(await outcome(() => signInEmergency(emergency(), 'en'))).toBe('returned {"ok":true,"next":"mfa_required"}');
    expect(jar.set).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('signs the Administrator in with the right password and code, and audits it', async () => {
    const ctx = await admin();
    expect(await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'en'))).toBe('NEXT_REDIRECT en /admin/users-roles');
    expect(await sessionInJar()).toEqual({ role: 'administrator', installMode: 'private', zoneIds: [] });
    expect(jar.set).toHaveBeenCalledTimes(1);
    expect((await eventsOf(ctx, 'auth.emergency_admin_sign_in')).at(0)).toMatchObject({ outcome: 'success', actor_type: 'emergency_admin' });
    expect(await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'ar'))).toBe('NEXT_REDIRECT ar /admin/users-roles');
  });

  it('keeps the install mode of the mode cookie', async () => {
    store.set(DEMO_MODE_COOKIE, signDemoMode('shared', SECRET, now()));
    await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'en'));
    expect(await sessionInJar()).toEqual({ role: 'administrator', installMode: 'shared', zoneIds: [] });
  });

  it('says only "invalid credentials" for a wrong password, a wrong code and an unknown account', async () => {
    const results = [
      await outcome(() => signInEmergency(emergency({ password: `${PASSWORD}x` }), 'en')),
      await outcome(() => signInEmergency(emergency({ totp_code: WRONG_CODE }), 'en')),
      await outcome(() => signInEmergency(emergency({ email: 'someone.else@demo.example' }), 'en')),
    ];
    for (const result of results) expect(result).toBe('returned {"ok":false,"error":"invalid_credentials"}');
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('locks after five failures: even the right password and code are then refused', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(await outcome(() => signInEmergency(emergency({ password: `wrong-${attempt}` }), 'en'))).toBe('returned {"ok":false,"error":"invalid_credentials"}');
    }
    expect(await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'en'))).toBe('returned {"ok":false,"error":"locked"}');
    expect(await outcome(() => signInEmergency(emergency(), 'en'))).toBe('returned {"ok":false,"error":"locked"}');
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('a right password does not count as a failure, so asking for the code any number of times never locks', async () => {
    for (let i = 0; i < 7; i += 1) expect(await outcome(() => signInEmergency(emergency(), 'en'))).toBe('returned {"ok":true,"next":"mfa_required"}');
    expect(await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'en'))).toBe('NEXT_REDIRECT en /admin/users-roles');
  });

  it('refuses a body with any other field, before the data layer is called: no cookie, no account, no audit event', async () => {
    const ctx = await admin();
    const before = (await eventsOf(ctx, 'auth.mock_sign_in')).length;
    const forged = [
      { role: 'administrator' },
      { assigned_role: 'administrator' },
      { installMode: 'shared' },
      { install_mode: 'shared' },
      { customerId: 'other-customer' },
      { tenant_id: 'other-customer' },
      { userId: 'someone' },
      { zoneIds: ['z'] },
      { zoneScope: { kind: 'whole_install' } },
      { extra: 'x' },
    ];
    for (const fields of forged) {
      // subject and groups of a planner: what the person "types". The forged field asks for more.
      const body = { ...mock({ subject: 'forger@demo.example', groups: ['opendispatch-planners-riyadh'] }), ...fields };
      expect(await outcome(() => signInMock(body as never, 'en')), JSON.stringify(fields)).toBe('returned {"ok":false,"error":"invalid"}');
    }
    expect(jar.set).not.toHaveBeenCalled();
    expect(await eventsOf(ctx, 'auth.mock_sign_in')).toHaveLength(before);
  });

  it('refuses input that is not the three typed fields', async () => {
    for (const bad of [null, undefined, 'administrator', 42, [], {}, { provider_id: MOCK, subject: 'a' }, { provider_id: MOCK, groups: [] }, mock({ groups: 'opendispatch-administrators' as never }), mock({ groups: [1 as never] }), mock({ subject: 5 as never }), mock({ provider_id: null as never }), mock({ groups: Array.from({ length: 65 }, (_, i) => `g${i}`) })]) {
      expect(await outcome(() => signInMock(bad as never, 'en')), JSON.stringify(bad)).toBe('returned {"ok":false,"error":"invalid"}');
    }
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('the cookie role equals what the data function answered: a session cannot be asked for', async () => {
    // Whatever the person types, the session is the rule's. Typing "role" is refused (above); typing a role name as a group is only a group.
    await outcome(() => signInMock(mock({ subject: 'administrator', groups: ['administrator'] }), 'en'));
    expect(jar.set).not.toHaveBeenCalled();
    await outcome(() => signInMock(mock({ subject: 'x@demo.example', groups: ['opendispatch-remote-team-leads'] }), 'en'));
    expect(await sessionInJar()).toEqual({ role: 'remote_team_lead', installMode: 'private', zoneIds: [] });
  });
});

describe('signInEmergency', () => {
  it('asks for the code when the password is right, without a session', async () => {
    expect(await outcome(() => signInEmergency(emergency(), 'en'))).toBe('returned {"ok":true,"next":"mfa_required"}');
    expect(jar.set).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('signs the Administrator in with the right password and code, and audits it', async () => {
    const ctx = await admin();
    expect(await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'en'))).toBe('NEXT_REDIRECT en /admin/users-roles');
    expect(await sessionInJar()).toEqual({ role: 'administrator', installMode: 'private', zoneIds: [] });
    expect(jar.set).toHaveBeenCalledTimes(1);
    expect((await eventsOf(ctx, 'auth.emergency_admin_sign_in')).at(0)).toMatchObject({ outcome: 'success', actor_type: 'emergency_admin' });
    expect(await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'ar'))).toBe('NEXT_REDIRECT ar /admin/users-roles');
  });

  it('keeps the install mode of the mode cookie', async () => {
    store.set(DEMO_MODE_COOKIE, signDemoMode('shared', SECRET, now()));
    await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'en'));
    expect(await sessionInJar()).toEqual({ role: 'administrator', installMode: 'shared', zoneIds: [] });
  });

  it('says only "invalid credentials" for a wrong password, a wrong code and an unknown account', async () => {
    const results = [
      await outcome(() => signInEmergency(emergency({ password: `${PASSWORD}x` }), 'en')),
      await outcome(() => signInEmergency(emergency({ totp_code: WRONG_CODE }), 'en')),
      await outcome(() => signInEmergency(emergency({ email: 'someone.else@demo.example' }), 'en')),
    ];
    for (const result of results) expect(result).toBe('returned {"ok":false,"error":"invalid_credentials"}');
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('locks after five failures: even the right password and code are then refused', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(await outcome(() => signInEmergency(emergency({ password: `wrong-${attempt}` }), 'en'))).toBe('returned {"ok":false,"error":"invalid_credentials"}');
    }
    expect(await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'en'))).toBe('returned {"ok":false,"error":"locked"}');
    expect(await outcome(() => signInEmergency(emergency(), 'en'))).toBe('returned {"ok":false,"error":"locked"}');
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('a right password does not count as a failure, so asking for the code any number of times never locks', async () => {
    for (let i = 0; i < 7; i += 1) expect(await outcome(() => signInEmergency(emergency(), 'en'))).toBe('returned {"ok":true,"next":"mfa_required"}');
    expect(await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'en'))).toBe('NEXT_REDIRECT en /admin/users-roles');
  });

  it('refuses a body with any other field, a code that is not six digits and an empty password', async () => {
    const ctx = await admin();
    const before = (await eventsOf(ctx, 'auth.emergency_admin_sign_in')).length;
    for (const fields of [{ role: 'administrator' }, { installMode: 'shared' }, { customerId: 'x' }, { userId: 'x' }, { zoneIds: [] }]) {
      expect(await outcome(() => signInEmergency({ ...emergency({ totp_code: CODE }), ...fields } as never, 'en')), JSON.stringify(fields)).toBe('returned {"ok":false,"error":"invalid"}');
    }
    for (const bad of [null, 'x', {}, { email: 'a' }, { email: EMERGENCY_EMAIL, password: 5 }, emergency({ totp_code: 123456 as never })]) {
      expect(await outcome(() => signInEmergency(bad as never, 'en'))).toBe('returned {"ok":false,"error":"invalid"}');
    }
    expect(await eventsOf(ctx, 'auth.emergency_admin_sign_in')).toHaveLength(before);
    // the data layer refuses these itself
    expect(await outcome(() => signInEmergency(emergency({ totp_code: '12345' }), 'en'))).toBe('returned {"ok":false,"error":"invalid"}');
    expect(await outcome(() => signInEmergency(emergency({ password: '' }), 'en'))).toBe('returned {"ok":false,"error":"invalid"}');
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('says "unavailable" and calls no data function when there is no usable session secret', async () => {
    const ctx = await admin();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env['DEMO_SESSION_SECRET'];
    expect(await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'en'))).toBe('returned {"ok":false,"error":"unavailable"}');
    process.env['DEMO_SESSION_SECRET'] = SECRET;
    expect(await eventsOf(ctx, 'auth.emergency_admin_sign_in')).toHaveLength(0);
  });

  it('never returns, stores or logs the password or the code', async () => {
    const consoleCalls: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void consoleCalls.push(args));
    const ctx = await admin();
    const attempts = [
      emergency(),
      emergency({ password: 'not-the-password-0123' }),
      emergency({ totp_code: WRONG_CODE }),
      emergency({ totp_code: '12345' }),
      { ...emergency({ totp_code: CODE }), role: 'administrator' },
      emergency({ totp_code: CODE }),
    ];
    const seen: string[] = [];
    for (const attempt of attempts) seen.push(await outcome(() => signInEmergency(attempt as never, 'en')));
    delete process.env['DEMO_SESSION_SECRET'];
    seen.push(await outcome(() => signInEmergency(emergency({ totp_code: CODE }), 'en')));
    process.env['DEMO_SESSION_SECRET'] = SECRET;

    const secrets = [PASSWORD, CODE, WRONG_CODE, 'not-the-password-0123'];
    const everything = JSON.stringify([seen, consoleCalls, [...store.values()], (await listAuditEvents(ctx, { limit: 200 })).items, [...jar.set.mock.calls]]);
    // the session token is Go's random value
    for (const secret of secrets) expect(everything, `a credential appears in the output: ${secret.length} characters`).not.toContain(secret);
  });
});

describe('signOutDemo', () => {
  const signedIn = async (role: 'administrator' | 'planner' = 'administrator') => {
    const result = await demoSignIn({ assigned_role: role, install_mode: 'private', zone_ids: [] });
    if (result.outcome !== 'signed_in') throw new Error(`demo sign-in: ${result.outcome}`);
    store.set(SESSION, result.session.value);
    return result.session.value;
  };

  it('audits the sign-out exactly once, BEFORE it clears the session cookie, then goes to the Signed out page', async () => {
    const ctx = await admin();
    const before = (await eventsOf(ctx, 'auth.sign_out')).length;
    await signedIn();
    let auditedWhenCleared = -1;
    jar.delete.mockImplementation(async (name: string) => {
      auditedWhenCleared = (await eventsOf(ctx, 'auth.sign_out')).length;
      store.delete(name);
    });

    expect(await outcome(() => signOutDemo('en'))).toBe('NEXT_REDIRECT en /signed-out');
    await jar.delete.mock.results[0]?.value; // production never awaits jar.delete

    expect(auditedWhenCleared).toBe(before + 1);
    expect(await eventsOf(ctx, 'auth.sign_out')).toHaveLength(before + 1);
    expect(jar.delete).toHaveBeenCalledTimes(1);
    expect(jar.delete).toHaveBeenCalledWith(SESSION);
    expect((await eventsOf(ctx, 'auth.sign_out')).at(0)).toMatchObject({ outcome: 'success', summary_en: 'Signed out.' });
    expect(store.has(SESSION)).toBe(false);
  });

  it('names the person who signed out: the audit actor is the user of the session', async () => {
    const ctx = await admin();
    await signedIn('planner');
    const planner = await requireRequestContext();
    await outcome(() => signOutDemo('en'));
    expect((await eventsOf(ctx, 'auth.sign_out')).at(0)).toMatchObject({ actor_user_id: planner.userId, entity_id: planner.userId });
  });

  it('never clears the install mode cookie', async () => {
    await signedIn();
    const mode = signDemoMode('shared', SECRET, now());
    store.set(DEMO_MODE_COOKIE, mode);
    await outcome(() => signOutDemo('en'));
    expect(jar.delete).not.toHaveBeenCalledWith(DEMO_MODE_COOKIE);
    expect(store.get(DEMO_MODE_COOKIE)).toBe(mode);
    expect(store.has(SESSION)).toBe(false);
  });

  it('goes to the Signed out page in the language of the page', async () => {
    await signedIn();
    expect(await outcome(() => signOutDemo('ar'))).toBe('NEXT_REDIRECT ar /signed-out');
    expect(await outcome(() => signOutDemo('xx'))).toBe('NEXT_REDIRECT en /signed-out');
  });

  it('a second sign-out has no session and audits nothing more', async () => {
    const ctx = await admin();
    const before = (await eventsOf(ctx, 'auth.sign_out')).length;
    await signedIn();
    await outcome(() => signOutDemo('en'));
    await outcome(() => signOutDemo('en'));
    expect(await eventsOf(ctx, 'auth.sign_out')).toHaveLength(before + 1);
  });

  it('without a valid session it does not throw: it clears the cookie, audits nothing and redirects', async () => {
    const ctx = await admin();
    const before = (await eventsOf(ctx, 'auth.sign_out')).length;
    const ended = await signedIn('planner');
    await outcome(() => signOutDemo('en'));
    const ownEvents = (await eventsOf(ctx, 'auth.sign_out')).length;
    expect(ownEvents).toBe(before + 1);
    for (const cookie of [undefined, '', 'garbage', 'a.b', ended]) {
      jar.delete.mockClear();
      redirectMock.mockClear();
      store.clear();
      if (cookie !== undefined) store.set(SESSION, cookie);
      expect(await outcome(() => signOutDemo('en')), String(cookie)).toBe('NEXT_REDIRECT en /signed-out');
      expect(jar.delete).toHaveBeenCalledWith(SESSION);
    }
    expect(await eventsOf(ctx, 'auth.sign_out')).toHaveLength(ownEvents);
  });

  it('clears the cookie and redirects even when the audit cannot be written, and logs why on the server', async () => {
    await signedIn();
    // the api cannot be reached
    process.env['OPENDISPATCH_API_URL'] = 'http://127.0.0.1:9';
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await outcome(() => signOutDemo('en'))).toBe('NEXT_REDIRECT en /signed-out');
    expect(jar.delete).toHaveBeenCalledWith(SESSION);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Sign-out could not be audited'));
    expect(store.has(SESSION)).toBe(false);
  });
});
