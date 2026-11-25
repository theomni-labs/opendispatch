// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { getSignInPolicy, listIdentityProviders, listRoleMappings } from '@/lib/data/identity';
import { getSessionPolicy } from '@/lib/data/system';
import { removeProvider, removeRule, requestChange, saveAndTestProvider, saveProvider, saveSignInPolicy, setEmergencySignIn, setProviderEnabled, setRuleEnabled, testProvider } from './actions';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions against the real data layer and the committed fixtures, with the demo store in a temp folder. The session is
// the only thing stood in for: requireRequestContext returns the context of the role and install mode the test picks.
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

// Reading uses an administrator context whatever the session says, so a test can look at what a call left behind.
async function adminContext(mode: InstallMode = 'private'): Promise<RequestContext> {
  return contextOf('administrator', mode);
}
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;
const providers = async () => (await listIdentityProviders(await adminContext(), { limit: 200 })).items;
const rules = async () => (await listRoleMappings(await adminContext(), { limit: 200 })).items;

const SECRET = 'example-not-a-secret-value';
const okta = (change: Record<string, unknown> = {}) => ({
  preset_id: 'okta',
  display_name: 'Okta test',
  email_domains: ['acme.example'],
  config: { okta_domain: 'example.okta.com', client_id: 'opendispatch-test' },
  client_secret: SECRET,
  claim_mapping: { email: 'email', name: 'name', groups: 'groups' },
  ...change,
});

describe('saveProvider', () => {
  it('adds a provider disabled, audits it, and refreshes the page in both languages', async () => {
    const result = await saveProvider(okta());
    expect(result).toMatchObject({ ok: true, data: { name: 'Okta test', enabled: false } });
    const stored = (await providers()).find((p) => p.display_name === 'Okta test');
    expect(stored).toMatchObject({ preset_id: 'okta', is_enabled: false, has_secret: true, email_domains: ['acme.example'] });
    expect((await events('identity_provider.created')).at(0)).toMatchObject({ outcome: 'success' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/sign-in-identity', '/ar/admin/sign-in-identity']);
  });

  it('never keeps, returns or logs the secret it was given', async () => {
    const result = await saveProvider(okta());
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(await providers())).not.toContain(SECRET);
    expect(JSON.stringify(await events('identity_provider.created'))).not.toContain(SECRET);
    expect(errorLog.mock.calls.flat().join('\n')).not.toContain(SECRET);
    const bad = await saveProvider(okta({ config: {} }));
    expect(bad).toMatchObject({ ok: false, code: 'invalid' });
    expect(JSON.stringify(bad)).not.toContain(SECRET);
  });

  it('changes a provider and keeps its enabled state', async () => {
    const created = await saveProvider(okta());
    if (!created.ok) throw new Error('not created');
    await setProviderEnabled({ providerId: created.data.id, enabled: true });
    const changed = await saveProvider({ ...okta({ display_name: 'Okta renamed' }), providerId: created.data.id } as never);
    expect(changed).toMatchObject({ ok: true, data: { id: created.data.id, name: 'Okta renamed', enabled: true } });
  });

  it.each([
    ['an unknown preset', { preset_id: 'nope' }],
    ['a setting the preset does not have', { config: { okta_domain: 'x.example', client_id: 'a', bogus: 'b' } }],
    ['a required setting left empty', { config: { okta_domain: '', client_id: 'a' } }],
    ['no client secret for a new provider', { client_secret: undefined }],
    ['a domain that is not a domain', { email_domains: ['not a domain'] }],
    ['an empty name', { display_name: '' }],
  ])('refuses %s, as `invalid`, and adds nothing', async (_name, change) => {
    const before = (await providers()).length;
    expect(await saveProvider(okta(change as Record<string, unknown>) as never)).toMatchObject({ ok: false, code: 'invalid' });
    expect((await providers()).length).toBe(before);
  });

  it('refuses the mock provider as `conflict`, and a provider that does not exist as `not_found`', async () => {
    expect(await saveProvider({ ...okta(), providerId: 'mock-provider' } as never)).toMatchObject({ ok: false, code: 'conflict' });
    expect(await saveProvider({ ...okta(), providerId: 'okta-00000000' } as never)).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', '__proto__', 'constructor', '../x']) expect(await saveProvider({ ...okta(), providerId: bad } as never), bad).toMatchObject({ ok: false });
  });

  it('never forwards a field it does not name: a crafted body cannot make the provider enabled or change the customer', async () => {
    const result = await saveProvider({ ...okta(), is_enabled: true, customerId: 'someone-else', role: 'administrator', read_only: false } as never);
    expect(result).toMatchObject({ ok: true, data: { enabled: false } });
  });

  it('is refused in a shared install (the Administrator only reads there) and audited as denied', async () => {
    session.mode = 'shared';
    expect(await saveProvider(okta())).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await providers()).some((p) => p.display_name === 'Okta test')).toBe(false);
    expect((await events('identity_provider.created')).map((e) => e.outcome)).toEqual(['denied']);
    expect(session.revalidate).not.toHaveBeenCalled();
  });

  it('is refused for every role that is not the Administrator, audited as denied, and answers `unauthenticated` with no session', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      session.role = role;
      expect(await saveProvider(okta()), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events('identity_provider.created')).every((e) => e.outcome === 'denied')).toBe(true);
    session.role = null;
    expect(await saveProvider(okta())).toMatchObject({ ok: false, code: 'unauthenticated' });
  });
});

describe('the connection test (a labelled stub)', () => {
  it('saves the provider and runs the scripted test on it: it passes, with the four checks and their codes', async () => {
    const result = await saveAndTestProvider(okta());
    expect(result).toMatchObject({ ok: true, data: { provider: { enabled: false }, test: { ok: true, referenceCode: null } } });
    if (!result.ok) return;
    expect(result.data.test.steps.map((s) => s.code)).toEqual(['reach', 'discovery', 'client', 'claims']);
    expect(result.data.test.steps.every((s) => s.ok)).toBe(true);
    expect((await providers()).find((p) => p.id === result.data.provider.id)).toMatchObject({ last_test_ok: true });
    expect((await events('identity_provider.tested')).at(0)?.summary_en).toContain('passed');
  });

  it('fails with a reference code when a setting contains the word "invalid", and the saved provider says so', async () => {
    const result = await saveAndTestProvider(okta({ config: { okta_domain: 'invalid.example', client_id: 'opendispatch-test' } }));
    expect(result).toMatchObject({ ok: true, data: { test: { ok: false } } });
    if (!result.ok) return;
    expect(result.data.test.referenceCode).toMatch(/^IDP-[0-9A-F]{6}$/);
    expect(result.data.test.steps[0]).toMatchObject({ code: 'reach', ok: false, message: 'The provider address did not answer.' });
    expect((await providers()).find((p) => p.id === result.data.provider.id)).toMatchObject({ last_test_ok: false });
  });

  it('tests a saved provider again with its id, and knows the SAML steps', async () => {
    const created = await saveAndTestProvider({ preset_id: 'generic_saml', display_name: 'SAML test', email_domains: [], config: { sso_url: 'https://idp.example.com/sso', entity_id: 'https://idp.example.com/m', signing_certificate: 'MIIBsynthetic'.padEnd(80, 'A') }, claim_mapping: { email: 'e', name: 'n', groups: 'g' } } as never);
    if (!created.ok) throw new Error('not created');
    expect(created.data.test.steps.map((s) => s.code)).toEqual(['reach', 'saml', 'signed', 'attrs']);
    expect(await testProvider({ providerId: created.data.provider.id })).toMatchObject({ ok: true, data: { ok: true } });
    expect(await testProvider({ providerId: 'mock-provider' })).toMatchObject({ ok: true, data: { ok: true } });
    expect(await testProvider({ providerId: 'nobody-00000000' })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('is refused in a shared install and audited as denied', async () => {
    session.mode = 'shared';
    expect(await testProvider({ providerId: 'mock-provider' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('identity_provider.tested')).map((e) => e.outcome)).toEqual(['denied']);
  });
});

describe('setProviderEnabled and removeProvider', () => {
  it('enables and disables a provider, audits it, and keeps every setting', async () => {
    const created = await saveProvider(okta());
    if (!created.ok) throw new Error('not created');
    expect(await setProviderEnabled({ providerId: created.data.id, enabled: true })).toMatchObject({ ok: true, data: { enabled: true } });
    expect((await providers()).find((p) => p.id === created.data.id)).toMatchObject({ is_enabled: true, has_secret: true, config: { okta_domain: 'example.okta.com' } });
    expect(await setProviderEnabled({ providerId: created.data.id, enabled: false })).toMatchObject({ ok: true, data: { enabled: false } });
    expect((await events('identity_provider.updated')).map((e) => e.outcome)).toEqual(['success', 'success']);
  });

  it('refuses the mock provider (`conflict`), a missing provider and a value that is not a boolean', async () => {
    expect(await setProviderEnabled({ providerId: 'mock-provider', enabled: false })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await setProviderEnabled({ providerId: 'nobody-00000000', enabled: true })).toMatchObject({ ok: false, code: 'not_found' });
    const created = await saveProvider(okta());
    if (!created.ok) throw new Error('not created');
    expect(await setProviderEnabled({ providerId: created.data.id, enabled: 'yes' as never })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('is refused for a role that cannot even read providers, and audited as denied', async () => {
    session.role = 'planner';
    expect(await setProviderEnabled({ providerId: 'mock-provider', enabled: true })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('identity_provider.updated')).map((e) => e.outcome)).toEqual(['denied']);
  });

  it('removes a provider, and refuses the mock provider and one a group rule uses', async () => {
    const created = await saveProvider(okta());
    if (!created.ok) throw new Error('not created');
    expect(await removeProvider({ providerId: created.data.id })).toMatchObject({ ok: true, data: { removed: true } });
    expect((await providers()).some((p) => p.id === created.data.id)).toBe(false);
    expect(await removeProvider({ providerId: 'mock-provider' })).toMatchObject({ ok: false, code: 'conflict' });
    expect((await events('identity_provider.deleted')).map((e) => e.outcome)).toEqual(['success']);
  });
});

describe('group rules', () => {
  // saveRule tests that build a rule (the `rule` helper
  // always awaits live zones) moved to actions.live.test.ts.

  it('turns a rule on and off without touching anything else, and removes one', async () => {
    const target = (await rules())[0] as NonNullable<Awaited<ReturnType<typeof rules>>[number]>;
    expect(await setRuleEnabled({ ruleId: target.id, enabled: false })).toMatchObject({ ok: true });
    expect((await rules()).find((r) => r.id === target.id)).toMatchObject({ is_enabled: false, group_match: target.group_match, priority: target.priority, assigned_role: target.assigned_role });
    expect(await removeRule({ ruleId: target.id })).toMatchObject({ ok: true, data: { removed: true } });
    expect((await rules()).some((r) => r.id === target.id)).toBe(false);
    expect((await events('role_mapping.deleted')).map((e) => e.outcome)).toEqual(['success']);
  });

  it('answers `not_found` for a rule that does not exist and `invalid` for an id that is not one', async () => {
    expect(await setRuleEnabled({ ruleId: '00000000-0000-4000-8000-00000000dead', enabled: true })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await removeRule({ ruleId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', 'toString', '__proto__', 42, null, undefined]) expect(await removeRule({ ruleId: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('is refused in a shared install and for other roles, audited as denied, and changes nothing', async () => {
    const before = JSON.stringify(await rules());
    const target = (await rules())[0] as NonNullable<Awaited<ReturnType<typeof rules>>[number]>;
    session.mode = 'shared';
    expect(await setRuleEnabled({ ruleId: target.id, enabled: false })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await removeRule({ ruleId: target.id })).toMatchObject({ ok: false, code: 'forbidden' });
    session.mode = 'private';
    session.role = 'viewer_auditor';
    expect(await setRuleEnabled({ ruleId: target.id, enabled: false })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(JSON.stringify(await rules())).toBe(before);
    expect((await events('role_mapping.updated')).map((e) => e.outcome)).toEqual(['denied', 'denied']);
  });
});

// previewRules always reads live zones now: see
// previewRules describe in actions.live.test.ts.

describe('saveSignInPolicy: the sign-in policy first, then the session length', () => {
  const input = (change: Record<string, unknown> = {}) => ({ force_sso_email_domains: ['demo.example', 'acme.example'], require_mfa_claim: true, session_length_minutes: 240, ...change });

  it('writes both, audits both, and keeps what the tab does not show (outsiders, emergency sign-in, idle timeout)', async () => {
    const result = await saveSignInPolicy(input() as never);
    expect(result).toMatchObject({ ok: true, data: { forceDomains: ['demo.example', 'acme.example'], requireMfa: true, sessionMinutes: 240 } });
    const ctx = await adminContext();
    expect(await getSignInPolicy(ctx)).toEqual({ force_sso_email_domains: ['demo.example', 'acme.example'], require_mfa_claim: true, allow_local_users_for_outsiders: false, emergency_admin_enabled: true });
    expect(await getSessionPolicy(ctx)).toEqual({ session_length_minutes: 240, idle_timeout_minutes: 30, max_concurrent_sessions: 3 });
    expect((await events('sign_in_policy.updated')).map((e) => e.outcome)).toEqual(['success']);
    expect((await events('session_policy.updated')).map((e) => e.outcome)).toEqual(['success']);
  });

  it('writes the session policy only when the length changed', async () => {
    await saveSignInPolicy(input({ session_length_minutes: 480 }) as never);
    expect(await events('session_policy.updated')).toHaveLength(0);
    expect(await events('sign_in_policy.updated')).toHaveLength(1);
  });

  it('turns SSO enforcement off with an empty list of domains', async () => {
    expect(await saveSignInPolicy(input({ force_sso_email_domains: [], session_length_minutes: 480 }) as never)).toMatchObject({ ok: true, data: { forceDomains: [] } });
  });

  it('refuses a bad domain as `invalid` and leaves the session length alone', async () => {
    expect(await saveSignInPolicy(input({ force_sso_email_domains: ['not a domain'] }) as never)).toMatchObject({ ok: false, code: 'invalid' });
    expect((await getSessionPolicy(await adminContext())).session_length_minutes).toBe(480);
    expect(await events('session_policy.updated')).toHaveLength(0);
  });

  it('in a shared install the sign-in policy write is refused (audited as denied) so the session length is not written either', async () => {
    session.mode = 'shared';
    expect(await saveSignInPolicy(input() as never)).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await getSessionPolicy(await adminContext())).session_length_minutes).toBe(480);
    expect((await events('sign_in_policy.updated')).map((e) => e.outcome)).toEqual(['denied']);
    expect(await events('session_policy.updated')).toHaveLength(0);
  });

  it('is refused for every other role, audited as denied, with no session as `unauthenticated`', async () => {
    session.role = 'planner';
    expect(await saveSignInPolicy(input() as never)).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('sign_in_policy.updated')).map((e) => e.outcome)).toEqual(['denied']);
    session.role = null;
    expect(await saveSignInPolicy(input() as never)).toMatchObject({ ok: false, code: 'unauthenticated' });
  });
});

describe('setEmergencySignIn', () => {
  it('switches emergency sign-in off and on, and writes the rest of the policy back as it was', async () => {
    const ctx = await adminContext();
    const before = await getSignInPolicy(ctx);
    expect(await setEmergencySignIn({ enabled: false })).toMatchObject({ ok: true, data: { enabled: false } });
    expect(await getSignInPolicy(ctx)).toEqual({ ...before, emergency_admin_enabled: false });
    expect(await setEmergencySignIn({ enabled: true })).toMatchObject({ ok: true, data: { enabled: true } });
    expect(await getSignInPolicy(ctx)).toEqual(before);
    expect((await events('sign_in_policy.updated')).map((e) => e.outcome)).toEqual(['success', 'success']);
  });

  it('refuses a value that is not a boolean, and a shared install, and other roles', async () => {
    expect(await setEmergencySignIn({ enabled: 'no' as never })).toMatchObject({ ok: false, code: 'invalid' });
    session.mode = 'shared';
    expect(await setEmergencySignIn({ enabled: false })).toMatchObject({ ok: false, code: 'forbidden' });
    session.mode = 'private';
    session.role = 'viewer_auditor';
    expect(await setEmergencySignIn({ enabled: false })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await getSignInPolicy(await adminContext())).emergency_admin_enabled).toBe(true);
  });
});

describe('requestChange (a labelled stub: nothing is sent)', () => {
  it('audits the request, raises an alert and returns a reference code; the providers do not change', async () => {
    session.mode = 'shared';
    const before = JSON.stringify(await providers());
    const result = await requestChange({ change: 'Add our second Entra ID tenant.' });
    expect(result).toMatchObject({ ok: true, data: { referenceCode: expect.stringMatching(/^CHG-[0-9A-F]{8}$/) } });
    expect((await events('identity.change_requested')).at(0)).toMatchObject({ outcome: 'success' });
    expect(JSON.stringify(await providers())).toBe(before);
  });

  it('names a provider when one is given, and refuses one that does not exist, an empty request and one that is too long', async () => {
    expect(await requestChange({ providerId: 'mock-provider', change: 'Switch it off.' })).toMatchObject({ ok: true });
    expect(await requestChange({ providerId: 'nobody-00000000', change: 'x' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await requestChange({ change: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await requestChange({ change: 'x'.repeat(1001) })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('is refused for a role with no access to the module', async () => {
    session.role = 'planner';
    expect(await requestChange({ change: 'x' })).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('an unexpected error', () => {
  it('returns a reference ODP- and 8 hex characters, logs only that reference and the error name, and leaks no input', async () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError(`boom: client_secret=${SECRET}`);
      },
    });
    const result = await saveProvider(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${SECRET}|boom`));
    const logged = errorLog.mock.calls.flat().join('\n');
    expect(logged).toContain(result.reference);
    expect(logged).not.toMatch(new RegExp(`${SECRET}|boom`));
  });
});

describe('the server-built context rule in this file', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
  const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

  it('is a use-server file whose exports are all async functions', () => {
    expect(source.trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(10);
    expect([...new Set(exported)]).toEqual(['async']);
  });

  it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
    const inputTypes = types.slice(types.indexOf('What the browser sends'));
    const fields = [...inputTypes.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
    expect(fields.length).toBeGreaterThan(20);
    for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
  });
});
