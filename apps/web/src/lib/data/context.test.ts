// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES, type InstallMode, type Role } from '@/lib/access';
import { DEMO_MODE_COOKIE, signDemoMode } from '@/lib/session/demo-session';
import type { User, Zone } from '@/lib/types';
import { demoSignIn } from './auth-session';
import { buildPreSessionContext, demoCustomerName, getDemoOptions, getPreSessionContext, getRequestContext, requirePlatform, requirePreSession, requireRequestContext, v } from './context';
import { ForbiddenError, InvalidInputError, UnauthenticatedError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { buildContext, ctxFor, fixtureTenantId, fixtureZoneIds, preSessionFor, withTempDemoState } from './test-support';

withTempDemoState();

const users = () => fixtureRecords<User>('User');

describe('buildContext', () => {
  it('picks the active seeded user of the session role and never the emergency admin', () => {
    const ctx = buildContext({ role: 'administrator', installMode: 'private', zoneIds: [] }, users(), fixtureTenantId());
    expect(ctx).not.toBeNull();
    const user = users().find((u) => u.id === ctx?.userId);
    expect(user?.assigned_role).toBe('administrator');
    expect(user?.is_emergency_admin).toBe(false);
    expect(ctx?.customerId).toBe(fixtureTenantId());
  });

  it('builds a context for every role that has a seeded user', () => {
    for (const role of ROLES) {
      const ctx = buildContext({ role, installMode: 'private', zoneIds: [] }, users(), fixtureTenantId());
      expect(ctx?.role).toBe(role);
    }
  });

  it('gives no context when the role has no active user (no default role)', () => {
    const none = users().map((u) => (u.assigned_role === 'planner' ? { ...u, status: 'disabled' as const } : u));
    expect(buildContext({ role: 'planner', installMode: 'private', zoneIds: [] }, none, fixtureTenantId())).toBeNull();
  });

  it('keeps only zone ids that exist and follows the role scope', () => {
    const zones = fixtureZoneIds();
    const planner = buildContext({ role: 'planner', installMode: 'private', zoneIds: [zones[0] as string, 'not-a-zone'] }, users(), fixtureTenantId());
    expect(planner?.zoneScope).toEqual({ kind: 'assigned_zones', zoneIds: [zones[0]] });
    expect(buildContext({ role: 'administrator', installMode: 'private', zoneIds: [zones[0] as string] }, users(), fixtureTenantId())?.zoneScope).toEqual({ kind: 'whole_install' });
    expect(buildContext({ role: 'remote_team_lead', installMode: 'private', zoneIds: [] }, users(), fixtureTenantId())?.zoneScope).toEqual({ kind: 'remote_pool' });
  });

  it('prefers the user whose zones match the chosen zones', () => {
    const zones = fixtureZoneIds();
    const extra: User = { ...(users().find((u) => u.assigned_role === 'planner') as User), id: '11111111-1111-4111-8111-111111111111', zone_ids: [zones[5] as string, zones[6] as string] };
    const ctx = buildContext({ role: 'planner', installMode: 'private', zoneIds: [zones[5] as string, zones[6] as string] }, [...users(), extra], fixtureTenantId());
    expect(ctx?.userId).toBe(extra.id);
  });
});

describe('ctxFor', () => {
  it('uses the real tenant and the seeded users zones by default', () => {
    const dispatcher = ctxFor('dispatcher');
    expect(dispatcher.customerId).toBe(fixtureTenantId());
    expect(dispatcher.zoneScope.kind).toBe('assigned_zones');
    expect(ctxFor('dispatcher', { zones: [fixtureZoneIds()[7] as string] }).zoneScope).toEqual({ kind: 'assigned_zones', zoneIds: [fixtureZoneIds()[7]] });
  });
});

describe('getDemoOptions', () => {
  it('lists zone names and the roles per install mode without any personal data', async () => {
    const options = await getDemoOptions();
    expect(options.tenantId).toBe(fixtureTenantId());
    expect(options.customerName).toBe('Example Response (synthetic)');
    expect(options.customerNameAr).toBe('مثال للاستجابة (بيانات اصطناعية)');
    expect(demoCustomerName(options, 'ar')).toBe(options.customerNameAr);
    expect(demoCustomerName(options, 'en')).toBe(options.customerName);
    expect(options.zones).toHaveLength(fixtureRecords<Zone>('Zone').length);
    expect(options.zones[0]).toEqual({ id: expect.any(String), name: 'Riyadh Central', cityName: 'Riyadh' });
    expect(options.rolesByInstallMode.private).toHaveLength(7);
    expect(options.rolesByInstallMode.shared).toHaveLength(6);
    expect(options.rolesByInstallMode.shared).not.toContain('change_approver');
  });
});

describe('platform access and helpers', () => {
  it('keeps the Change Approver out of platform.records and out of every module outside private installs', () => {
    expect(() => requirePlatform(ctxFor('change_approver'), 'platform.records')).toThrow(ForbiddenError);
    expect(() => requirePlatform(ctxFor('change_approver'), 'platform.session')).not.toThrow();
    expect(() => requirePlatform(ctxFor('change_approver', { installMode: 'shared' }), 'platform.session')).toThrow(ForbiddenError);
    expect(() => requirePlatform(ctxFor('viewer_auditor'), 'platform.records')).not.toThrow();
  });

  it('validates inputs against closed bodies', () => {
    expect(() => v.object({ a: 1, b: 2 }, 'Body', ['a'])).toThrow(InvalidInputError);
    expect(() => v.string({ name: '' }, 'name', { min: 1 })).toThrow(InvalidInputError);
    expect(() => v.enumOf({ k: 'x' }, 'k', ['a', 'b'] as const)).toThrow(InvalidInputError);
    expect(v.int({ n: 3 }, 'n', { min: 1, max: 5 })).toBe(3);
  });
});

// next/headers is a fake cookie jar.
let cookieValue: string | undefined;
let modeCookieValue: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === 'opendispatch_session' && cookieValue !== undefined) return { name, value: cookieValue };
      if (name === DEMO_MODE_COOKIE && modeCookieValue !== undefined) return { name, value: modeCookieValue };
      return undefined;
    },
  }),
}));

/** A real demo sign-in; returns its session. */
async function signedIn(role: Role, installMode: InstallMode, zoneIds: readonly string[]): Promise<string> {
  const result = await demoSignIn({ assigned_role: role, install_mode: installMode, zone_ids: [...zoneIds] });
  if (result.outcome !== 'signed_in') throw new Error(`demo sign-in: ${result.outcome}`);
  return result.session.value;
}

describe('getRequestContext (Go /me, both modes)', () => {
  beforeEach(() => {
    cookieValue = undefined;
    modeCookieValue = undefined;
  });

  it('is what Go says about the session: role, install mode, the chosen zones, the fixture customer', async () => {
    const zone = fixtureZoneIds()[0] as string;
    cookieValue = await signedIn('dispatcher', 'dedicated', [zone]);
    const ctx = await getRequestContext();
    expect(ctx).toMatchObject({ role: 'dispatcher', installMode: 'dedicated', customerId: fixtureTenantId(), zoneScope: { kind: 'assigned_zones', zoneIds: [zone] } });
    expect(await requireRequestContext()).toEqual(ctx);
  });

  it('gives no context, never a default role, for a missing, tampered or unknown session', async () => {
    expect(await getRequestContext()).toBeNull();
    await expect(requireRequestContext()).rejects.toBeInstanceOf(UnauthenticatedError);
    const good = await signedIn('planner', 'private', []);
    cookieValue = `${good.slice(0, -3)}abc`;
    expect(await getRequestContext()).toBeNull();
    cookieValue = 'garbage';
    expect(await getRequestContext()).toBeNull();
  });
});

describe('getPreSessionContext (the demo mode cookie, before anyone has signed in)', () => {
  const secret = 'test-secret-not-a-real-one-0123456789';
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  beforeEach(() => {
    vi.stubEnv('DEMO_SESSION_SECRET', secret);
    cookieValue = undefined;
    modeCookieValue = undefined;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the fixture customer and the private install mode when there is no cookie, and carries nothing else', async () => {
    const pre = await getPreSessionContext();
    expect(pre).toEqual({ customerId: fixtureTenantId(), installMode: 'private' });
    expect(Object.keys(pre).sort()).toEqual(['customerId', 'installMode']);
  });

  it.each(['private', 'dedicated', 'shared'] as const)('reads the install mode %s from the signed cookie', async (mode) => {
    modeCookieValue = signDemoMode(mode, secret, nowSeconds());
    expect(await getPreSessionContext()).toEqual({ customerId: fixtureTenantId(), installMode: mode });
  });

  it('falls back to private for a tampered, expired, foreign or garbage cookie, and never throws for those', async () => {
    const good = signDemoMode('shared', secret, nowSeconds());
    for (const bad of [`${good.slice(0, -3)}abc`, 'garbage', '', signDemoMode('shared', 'a-different-usable-secret-0123456789-abc', nowSeconds()), signDemoMode('shared', secret, nowSeconds() - 40 * 24 * 60 * 60)]) {
      modeCookieValue = bad;
      expect(await getPreSessionContext(), bad).toEqual({ customerId: fixtureTenantId(), installMode: 'private' });
    }
  });

  it('does not read the session cookie: a signed-in visitor is a RequestContext, not this, and gains no role from it', async () => {
    cookieValue = await signedIn('administrator', 'shared', []);
    const pre = await getPreSessionContext();
    expect(pre).toEqual({ customerId: fixtureTenantId(), installMode: 'private' });
    expect('role' in pre).toBe(false);
    // and a session token put in the mode cookie is not a mode
    modeCookieValue = cookieValue;
    expect((await getPreSessionContext()).installMode).toBe('private');
  });

  it('refuses to read a cookie without a secret in the environment (fail closed)', async () => {
    modeCookieValue = signDemoMode('shared', secret, nowSeconds());
    vi.stubEnv('DEMO_SESSION_SECRET', '');
    await expect(getPreSessionContext()).rejects.toThrow(/DEMO_SESSION_SECRET/);
  });
});

describe('requirePreSession and buildPreSessionContext', () => {
  it('builds the context from a customer and an install mode, nothing else', () => {
    expect(buildPreSessionContext(fixtureTenantId(), 'shared')).toEqual({ customerId: fixtureTenantId(), installMode: 'shared' });
  });

  it('accepts what getPreSessionContext builds, in every install mode', () => {
    for (const mode of ['private', 'dedicated', 'shared'] as const) expect(() => requirePreSession(preSessionFor(mode))).not.toThrow();
  });

  it('refuses a RequestContext (a role somebody made up), a forged field, an unknown customer, an unknown mode and non-objects', () => {
    // @ts-expect-error a RequestContext is not a PreSessionContext
    expect(() => requirePreSession(ctxFor('viewer_auditor'))).toThrow(ForbiddenError);
    const good = preSessionFor();
    for (const bad of [{ ...good, role: 'viewer_auditor' }, { ...good, userId: ctxFor('planner').userId }, { ...good, zoneScope: { kind: 'whole_install' } }, { ...good, customerId: 'not-a-customer' }, { ...good, installMode: 'cloud' }, { installMode: 'private' }, null, undefined, 'private', 7, []]) {
      expect(() => requirePreSession(bad as never), JSON.stringify(bad)).toThrow(ForbiddenError);
    }
  });
});
