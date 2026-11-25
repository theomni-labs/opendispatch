// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_MODE_COOKIE, DEMO_MODE_MAX_AGE_SECONDS, verifyDemoMode } from '@/lib/session/demo-session';

// next/headers, the localized redirect and the data layer's options are mocked: this file tests setDemoSession's own
// validation, the cookies it writes and where it sends the person. The sign-in and sign-out actions run against the
// real data layer and have their own file (actions.sign-in.test.ts).
const jar = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn() }));
const redirectMock = vi.hoisted(() =>
  vi.fn((target: { href: string; locale: string }) => {
    throw new Error(`NEXT_REDIRECT ${target.locale} ${target.href}`);
  }),
);

const go = vi.hoisted(() => ({ outcome: 'signed_in' as string }));
const demoSignIn = vi.hoisted(() =>
  vi.fn<(body: unknown) => Promise<unknown>>(async () => (go.outcome === 'signed_in' ? { outcome: 'signed_in', result: {}, session: { value: 'go-session-token', maxAge: 43_200 } } : { outcome: go.outcome })),
);

vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('@/lib/data/auth-session', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/data/auth-session')>()), demoSignIn }));
vi.mock('@/i18n/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/data/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/context')>()),
  getDemoOptions: async () => ({
    customerName: 'Example Response (synthetic)',
    tenantId: 'tenant-1',
    zones: [
      { id: 'zone-a', name: 'Riyadh Central', cityName: 'Riyadh' },
      { id: 'zone-b', name: 'Jeddah North', cityName: 'Jeddah' },
    ],
    installModes: ['private', 'dedicated', 'shared'],
    rolesByInstallMode: {
      private: ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'],
      dedicated: ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor'],
      shared: ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor'],
    },
  }),
}));

import { setDemoSession } from './actions';

const SECRET = 'test-secret-with-at-least-16-chars';

/** The body sent to Go's demo sign-in. */
const sentToGo = (): unknown => demoSignIn.mock.calls.at(-1)?.[0];

async function landsAt(input: unknown, locale = 'en'): Promise<string> {
  try {
    const result = await setDemoSession(input as never, locale);
    return `returned ${JSON.stringify(result)}`;
  } catch (error) {
    return (error as Error).message;
  }
}

beforeEach(() => {
  jar.set.mockClear();
  jar.delete.mockClear();
  redirectMock.mockClear();
  demoSignIn.mockClear();
  go.outcome = 'signed_in';
  process.env['DEMO_SESSION_SECRET'] = SECRET;
  delete process.env['DEMO_COOKIE_SECURE'];
});

describe('setDemoSession', () => {
  it('signs in at Go, sets Go\'s session as an HttpOnly, SameSite=Lax cookie and redirects to the role landing', async () => {
    const outcome = await landsAt({ role: 'dispatcher', installMode: 'private', zoneIds: ['zone-a'] });
    expect(outcome).toBe('NEXT_REDIRECT en /ops/live-dispatch-board');
    expect(sentToGo()).toEqual({ assigned_role: 'dispatcher', install_mode: 'private', zone_ids: ['zone-a'] });

    // The session cookie first, then the install mode cookie (the next test).
    expect(jar.set).toHaveBeenCalledTimes(2);
    const [name, token, options] = jar.set.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe('opendispatch_session');
    expect(token).toBe('go-session-token');
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 43_200, secure: false });
  });

  it('gives no session, never a default role, when Go has no account for the role', async () => {
    go.outcome = 'no_role_assigned';
    expect(await landsAt({ role: 'planner', installMode: 'private', zoneIds: [] })).toBe('NEXT_REDIRECT en /sign-in/message/no-role');
    expect(jar.set).not.toHaveBeenCalled();
    go.outcome = 'invalid';
    expect(await landsAt({ role: 'planner', installMode: 'private', zoneIds: [] })).toBe('returned {"ok":false,"error":"invalid"}');
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('writes the install mode cookie next to the session cookie: signed, HttpOnly, SameSite=Lax, 30 days, the mode and nothing else', async () => {
    for (const installMode of ['private', 'dedicated', 'shared']) {
      jar.set.mockClear();
      await landsAt({ role: 'administrator', installMode, zoneIds: [] });
      const [name, token, options] = jar.set.mock.calls[1] as [string, string, Record<string, unknown>];
      expect(name).toBe(DEMO_MODE_COOKIE);
      expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: DEMO_MODE_MAX_AGE_SECONDS, secure: false });
      expect(verifyDemoMode(token, SECRET, Math.floor(Date.now() / 1000))).toBe(installMode);
      // a token signed with another secret is not a mode (it reads as the default, private)
      expect(verifyDemoMode(token, 'another-secret-with-at-least-32-chars-0123', Math.floor(Date.now() / 1000))).toBe('private');
      // the payload holds the kind, the mode, the version and the expiry: no role, no user, no zones
      const payload = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(['exp', 'mode', 't', 'v']);
    }
  });

  it('writes neither cookie when the choice is refused', async () => {
    await landsAt({ role: 'root', installMode: 'private', zoneIds: [] });
    await landsAt({ role: 'dispatcher', installMode: 'private', zoneIds: ['zone-z'] });
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('marks both cookies Secure only when DEMO_COOKIE_SECURE=1', async () => {
    process.env['DEMO_COOKIE_SECURE'] = '1';
    await landsAt({ role: 'administrator', installMode: 'private', zoneIds: [] });
    expect(jar.set.mock.calls[0]?.[2]).toMatchObject({ secure: true });
    expect(jar.set.mock.calls[1]?.[2]).toMatchObject({ secure: true });
  });

  it('sends each role to its own landing, in the chosen language', async () => {
    expect(await landsAt({ role: 'administrator', installMode: 'private', zoneIds: [] }, 'ar')).toBe('NEXT_REDIRECT ar /admin/users-roles');
    expect(await landsAt({ role: 'change_approver', installMode: 'private', zoneIds: [] })).toBe('NEXT_REDIRECT en /admin/updates');
    expect(await landsAt({ role: 'planner', installMode: 'shared', zoneIds: ['zone-b'] })).toBe('NEXT_REDIRECT en /ops/field-planner');
    expect(await landsAt({ role: 'remote_team_lead', installMode: 'dedicated', zoneIds: [] })).toBe('NEXT_REDIRECT en /ops/remote-queue');
  });

  it('falls back to English for a locale it does not know', async () => {
    expect(await landsAt({ role: 'viewer_auditor', installMode: 'private', zoneIds: [] }, 'xx')).toMatch(/^NEXT_REDIRECT en /);
  });

  it('refuses a role or install mode outside the fixed lists, and sets no cookie', async () => {
    const bad = [
      { role: 'root', installMode: 'private', zoneIds: [] },
      { role: 'administrator', installMode: 'cloud', zoneIds: [] },
      { role: 'Administrator', installMode: 'private', zoneIds: [] },
      { role: 42, installMode: 'private', zoneIds: [] },
      { installMode: 'private', zoneIds: [] },
      { role: 'administrator', zoneIds: [] },
      null,
      'administrator',
    ];
    for (const input of bad) expect(await landsAt(input)).toBe('returned {"ok":false,"error":"invalid"}');
    expect(jar.set).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(demoSignIn).not.toHaveBeenCalled();
  });

  it('refuses the Change Approver outside a private install', async () => {
    for (const installMode of ['dedicated', 'shared']) {
      expect(await landsAt({ role: 'change_approver', installMode, zoneIds: [] })).toBe('returned {"ok":false,"error":"invalid"}');
    }
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('refuses zone ids the data layer does not report', async () => {
    expect(await landsAt({ role: 'dispatcher', installMode: 'private', zoneIds: ['zone-a', 'zone-z'] })).toBe('returned {"ok":false,"error":"unknown_zone"}');
    expect(await landsAt({ role: 'dispatcher', installMode: 'private', zoneIds: ['../../etc/passwd'] })).toBe('returned {"ok":false,"error":"invalid"}');
    expect(await landsAt({ role: 'dispatcher', installMode: 'private', zoneIds: 'zone-a' })).toBe('returned {"ok":false,"error":"invalid"}');
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('ignores the zone selection for whole-install and remote-pool roles', async () => {
    for (const role of ['administrator', 'viewer_auditor', 'change_approver', 'remote_team_lead']) {
      jar.set.mockClear();
      await landsAt({ role, installMode: 'private', zoneIds: ['zone-a', 'zone-b'] });
      expect((sentToGo() as { zone_ids: string[] }).zone_ids, role).toEqual([]);
    }
  });

  it('keeps the chosen zones for assigned-zone roles', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner']) {
      jar.set.mockClear();
      await landsAt({ role, installMode: 'private', zoneIds: ['zone-a', 'zone-b'] });
      expect((sentToGo() as { zone_ids: string[] }).zone_ids, role).toEqual(['zone-a', 'zone-b']);
    }
  });

  it('never takes a customer, user or scope from the input', async () => {
    await landsAt({ role: 'planner', installMode: 'private', zoneIds: ['zone-a'], customerId: 'other', userId: 'u1', zoneScope: { kind: 'whole_install' } });
    // role, mode and zones only; no customer
    expect(sentToGo()).toEqual({ assigned_role: 'planner', install_mode: 'private', zone_ids: ['zone-a'] });
  });

  it('sets no cookie and says only "unavailable" when the secret is missing', async () => {
    delete process.env['DEMO_SESSION_SECRET'];
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await landsAt({ role: 'administrator', installMode: 'private', zoneIds: [] })).toBe('returned {"ok":false,"error":"unavailable"}');
    expect(jar.set).not.toHaveBeenCalled();
    expect(demoSignIn).not.toHaveBeenCalled();
    // the server log names the cause; the secret value is never in it
    expect(log).toHaveBeenCalledWith(expect.stringContaining('DEMO_SESSION_SECRET'));
    log.mockRestore();
  });
});
