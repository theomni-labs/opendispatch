// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { createIdentityProvider, emergencyAdminSignIn, updateSignInPolicy } from '@/lib/data/identity';
import { loadMessages } from '@/i18n/messages';
import { messageLeaves } from '@/i18n/message-tree';
import { FIELD_LABEL } from './presets';
import { loadIdentityView, previewGroups, zoneCodeMap } from './view';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// loadIdentityView always reads live zones (zoneCodeMap),
// needed by every test here.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// The server side of the screen against the real data layer and the committed fixtures (3 providers with the mock one, 11
// group rules, 8 zones), with the demo store in a temp folder.
beforeEach(async () => {
  await resetGoTestState();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = (mode: InstallMode = 'private') => ctxOf('administrator', mode);

describe.skipIf(!hasApi)('sign_in_identity view (live, real api and Postgres)', () => {
  describe('loadIdentityView: providers, presets, rules', () => {
    it('lists the providers with the labelled mock provider, as plain data with no secret', async () => {
      const view = await loadIdentityView(admin(), {});
      expect(view.providers.length).toBeGreaterThanOrEqual(1);
      const mock = view.providers.find((provider) => provider.mock);
      expect(mock).toMatchObject({ id: 'mock-provider', name: 'Mock provider (demo only)', protocol: 'oidc', enabled: true, readOnly: true, lastTest: null });
      expect(view.sources).toContain('SYNTHETIC');
      // `client_secret` is the name of a preset field; no value of one is ever in the view.
      expect(JSON.stringify(view)).not.toMatch(/password|customerId|tenantId|"userId"/);
    });

    it('gives the nine presets with their fields, secrets marked, and the claims a preset starts with', async () => {
      const view = await loadIdentityView(admin(), {});
      expect(view.presets.map((preset) => preset.id)).toEqual(['entra_id_oidc', 'entra_id_saml', 'adfs_saml', 'adfs_oidc', 'okta', 'google_workspace', 'ping_identity', 'generic_oidc', 'generic_saml']);
      const entra = view.presets.find((preset) => preset.id === 'entra_id_oidc');
      expect(entra?.fields.map((field) => [field.key, field.required, field.secret])).toEqual([
        ['directory_tenant_id', true, false],
        ['client_id', true, false],
        ['client_secret', true, true],
      ]);
      expect(entra?.claims).toEqual({ email: 'email', name: 'name', groups: 'groups' });
      expect(view.presets.find((preset) => preset.id === 'generic_saml')?.protocol).toBe('saml');
    });

    it('gives the group rules lowest number first with zone codes (RD-C), the role\'s scope and whether the role exists here', async () => {
      const view = await loadIdentityView(admin(), {});
      expect(view.rules).toHaveLength(11);
      expect(view.rules.map((rule) => rule.priority)).toEqual([...view.rules.map((rule) => rule.priority)].sort((a, b) => a - b));
      expect(view.rules[0]).toMatchObject({ match: 'opendispatch-administrators', matchType: 'exact', role: 'administrator', scope: 'whole_install', zoneCodes: [], enabled: true, live: true });
      const supervisor = view.rules.find((rule) => rule.role === 'dispatch_supervisor');
      expect(supervisor?.scope).toBe('assigned_zones');
      expect(supervisor?.zoneCodes.length).toBeGreaterThan(0);
      expect(supervisor?.zoneCodes.every((code) => /^[A-Z]{2}-[A-Z]$/.test(code))).toBe(true);
    });

    it('marks a rule whose role does not exist in the install mode (Change Approver outside a private install) as not live', async () => {
      const privateView = await loadIdentityView(admin('private'), {});
      const sharedView = await loadIdentityView(admin('shared'), {});
      const changeApprover = (view: typeof privateView) => view.rules.find((rule) => rule.role === 'change_approver');
      expect(changeApprover(privateView)?.live).toBe(true);
      expect(changeApprover(sharedView)?.live).toBe(false);
      expect(sharedView.roleOptions.find((option) => option.role === 'change_approver')?.availableHere).toBe(false);
      expect(privateView.roleOptions.filter((option) => option.availableHere)).toHaveLength(7);
    });

    it('marks every provider read only in a shared install, and in a private one only the mock provider', async () => {
      expect((await loadIdentityView(admin('shared'), {})).providers.every((provider) => provider.readOnly)).toBe(true);
      const created = await createIdentityProvider(admin(), { preset_id: 'okta', display_name: 'Okta test', is_enabled: false, config: { okta_domain: 'example.okta.com', client_id: 'abc' }, client_secret: 'x' });
      const providers = (await loadIdentityView(admin('private'), {})).providers;
      expect(providers.filter((provider) => provider.readOnly).map((provider) => provider.id)).toEqual(['mock-provider']);
      expect(providers.some((provider) => provider.id === created.id)).toBe(true);
    });

    it('names the zones the rule editor picks from, grouped by city', async () => {
      const view = await loadIdentityView(admin(), {});
      expect(view.zones.length).toBeGreaterThanOrEqual(8);
      expect(view.zones.find((z) => z.code === 'RD-C')).toMatchObject({ cityName: expect.any(String) });
    });
  });

  describe('loadIdentityView: the preview', () => {
    it('starts with a group taken from the rules, and its result (a dispatcher rule when there is one)', async () => {
      const view = await loadIdentityView(admin(), {});
      expect(view.initialGroups).toBe('opendispatch-dispatch-riyadh-core');
      expect(view.initialPreview.role).toBe('dispatcher');
      expect(view.initialPreview.zoneCodes.length).toBeGreaterThan(0);
      expect(view.initialPreview.matchedIds).toHaveLength(1);
      expect(view.samples.at(-1)).toBe('unknown-group');
      expect(view.samples.length).toBeLessThanOrEqual(4);
    });

    it('gives no role for a group no rule matches: no access, never a default role', async () => {
      const ctx = admin();
      const result = await previewGroups(ctx, ['unknown-group'], await zoneCodeMap(ctx));
      expect(result).toEqual({ role: null, zoneCodes: [], matchedIds: [] });
      expect((await previewGroups(ctx, [], await zoneCodeMap(ctx))).role).toBeNull();
    });

    it('applies the lowest number first and merges the zones of the rules with that role', async () => {
      const ctx = admin();
      const codes = await zoneCodeMap(ctx);
      const view = await loadIdentityView(ctx, {});
      const supervisorGroups = view.rules.filter((rule) => rule.role === 'dispatch_supervisor').map((rule) => rule.match);
      const result = await previewGroups(ctx, supervisorGroups, codes);
      expect(result.role).toBe('dispatch_supervisor');
      expect(new Set(result.zoneCodes).size).toBe(result.zoneCodes.length);
      expect(result.matchedIds.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('loadIdentityView: the policy, the emergency tab and the export', () => {
    it('reads the sign-in policy and the session length (the Security module\'s setting)', async () => {
      const view = await loadIdentityView(admin(), {});
      expect(view.policy).toEqual({ forceDomains: ['demo.example'], requireMfa: false, sessionMinutes: 480, emergencyEnabled: true });
    });

    it('reads the emergency account and its recent use only for the Emergency tab', async () => {
      expect((await loadIdentityView(admin(), {})).emergency).toBeUndefined();
      const view = await loadIdentityView(admin(), { tab: 'emergency' });
      expect(view.emergency).toMatchObject({ name: 'Emergency Administrator', email: 'emergency.admin@demo.example' });
      expect(view.emergency?.events.map((event) => event.action)).toEqual(['auth.emergency_sign_in']);
    });

    it('shows a real emergency sign-in in its recent use, newest first', async () => {
      const password = process.env['DEMO_EMERGENCY_ADMIN_PASSWORD'] ?? '';
      const code = process.env['DEMO_EMERGENCY_ADMIN_TOTP'] ?? '';
      const pre = { customerId: fixtureTenantId(), installMode: 'private' as const };
      const email = 'emergency.admin@demo.example';
      expect((await emergencyAdminSignIn(pre, { email, password })).outcome).toBe('mfa_required');
      expect((await emergencyAdminSignIn(pre, { email, password, totp_code: code })).outcome).toBe('signed_in');
      const view = await loadIdentityView(admin(), { tab: 'emergency' });
      expect(view.emergency?.events.length).toBeGreaterThanOrEqual(2);
      expect(view.emergency?.events[0]).toMatchObject({ action: 'auth.emergency_admin_sign_in', outcome: 'success' });
      expect(view.emergency?.lastSignIn).not.toBeNull();
    });

    it('follows a change of the policy', async () => {
      const ctx = admin();
      await updateSignInPolicy(ctx, { force_sso_email_domains: [], require_mfa_claim: true, allow_local_users_for_outsiders: false, emergency_admin_enabled: false });
      const view = await loadIdentityView(ctx, {});
      expect(view.policy).toMatchObject({ forceDomains: [], requireMfa: true, emergencyEnabled: false });
    });

    it('exports the settings of every tab as JSON with no secret in it', async () => {
      const ctx = admin();
      await createIdentityProvider(ctx, { preset_id: 'okta', display_name: 'Okta test', is_enabled: true, config: { okta_domain: 'example.okta.com', client_id: 'abc' }, client_secret: 'example-not-a-secret-value' });
      const view = await loadIdentityView(ctx, {});
      const json = JSON.parse(view.exportJson) as { providers: { display_name: string }[]; group_rules: unknown[]; sign_in_policy: Record<string, unknown> };
      expect(json.providers.map((provider) => provider.display_name)).toContain('Okta test');
      expect(json.group_rules).toHaveLength(11);
      expect(json.sign_in_policy).toMatchObject({ session_length_minutes: 480 });
      expect(view.exportJson).not.toContain('example-not-a-secret-value');
      expect(view.exportJson).not.toMatch(/secret"\s*:/);
    });
  });

  describe('loadIdentityView: the drawers and the wizard from the address', () => {
    it('opens a provider by id, with its non-secret settings and claims', async () => {
      const ctx = admin();
      const created = await createIdentityProvider(ctx, { preset_id: 'okta', display_name: 'Okta test', is_enabled: false, email_domains: ['acme.example'], config: { okta_domain: 'example.okta.com', client_id: 'abc' }, client_secret: 'example-not-a-secret-value' });
      const view = await loadIdentityView(ctx, { provider: created.id });
      expect(view.openProvider).toMatchObject({ id: created.id, name: 'Okta test', presetName: 'Okta', enabled: false, domains: ['acme.example'], hasSecret: true, config: { okta_domain: 'example.okta.com', client_id: 'abc' } });
      expect(JSON.stringify(view.openProvider)).not.toContain('example-not-a-secret-value');
      expect(view.unknown.provider).toBe(false);
    });

    it('opens a rule by id or `new`, and says so for an id that names none', async () => {
      const ctx = admin();
      const base = await loadIdentityView(ctx, {});
      const id = base.rules[1]?.id as string;
      expect((await loadIdentityView(ctx, { rule: id })).openRule).toMatchObject({ id });
      expect((await loadIdentityView(ctx, { rule: 'new' })).openRule).toBe('new');
      const missing = await loadIdentityView(ctx, { rule: '00000000-0000-4000-8000-00000000dead' });
      expect(missing.openRule).toBeUndefined();
      expect(missing.unknown.rule).toBe(true);
    });

    it('opens the wizard for a new provider (`1`) or to change one, never for the mock provider or in a shared install', async () => {
      const ctx = admin();
      expect((await loadIdentityView(ctx, { wizard: '1' })).wizard).toEqual({ mode: 'new' });
      const created = await createIdentityProvider(ctx, { preset_id: 'okta', display_name: 'Okta test', is_enabled: false, config: { okta_domain: 'example.okta.com', client_id: 'abc' }, client_secret: 'x' });
      expect((await loadIdentityView(ctx, { wizard: created.id })).wizard).toMatchObject({ mode: 'edit', provider: { id: created.id } });
      const mock = await loadIdentityView(ctx, { wizard: 'mock-provider' });
      expect(mock.wizard).toBeUndefined();
      expect(mock.unknown.wizard).toBe(true);
      const shared = await loadIdentityView(admin('shared'), { wizard: created.id });
      expect(shared.wizard).toBeUndefined();
    });

    it('says so for a provider id that names none', async () => {
      const view = await loadIdentityView(admin(), { provider: 'nobody-3fa89d67' });
      expect(view.openProvider).toBeUndefined();
      expect(view.unknown.provider).toBe(true);
    });
  });

  describe('roles', () => {
    it('reads for the Administrator in every install mode and refuses every other role', async () => {
      for (const mode of ['private', 'dedicated', 'shared'] as const) await expect(loadIdentityView(admin(mode), {}), mode).resolves.toBeDefined();
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) await expect(loadIdentityView(ctxOf(role), {}), role).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('the message keys the screen looks up by preset, field and step', () => {
    const en = messageLeaves(loadMessages('en', 'admin.sign_in_identity'));
    const ar = messageLeaves(loadMessages('ar', 'admin.sign_in_identity'));
    const has = (key: string) => en[`admin.sign_in_identity.${key}`] !== undefined && ar[`admin.sign_in_identity.${key}`] !== undefined;

    it('has a label for every field of every preset, in both languages', async () => {
      const view = await loadIdentityView(admin(), {});
      for (const preset of view.presets) {
        for (const field of preset.fields) {
          const key = FIELD_LABEL[`${preset.id}.${field.key}`];
          expect(key, `${preset.id}.${field.key}`).toBeDefined();
          expect(has(`f.${key}`), `f.${key}`).toBe(true);
        }
      }
    });
  });
});
