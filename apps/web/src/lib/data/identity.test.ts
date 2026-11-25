// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallMode } from '@/lib/access';
import type { RoleMapping, User } from '@/lib/types';
import { listAuditEvents } from './audit';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError, UnauthenticatedError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import {
  MOCK_PROVIDER_ID,
  createIdentityProvider,
  createRoleMapping,
  deleteIdentityProvider,
  deleteRoleMapping,
  emergencyAdminSignIn,
  getIdentityProvider,
  getSessionContext,
  getSignInPolicy,
  listIdentityProviderPresets,
  listIdentityProviders,
  listRoleMappings,
  mockSignIn,
  previewRoleMappings,
  requestIdentityProviderChange,
  signOut,
  testIdentityProviderConnection,
  updateIdentityProvider,
  updateRoleMapping,
  updateSignInPolicy,
} from './identity';
import { countUnreadNotifications, listMyNotifications, listNotificationLog } from './notifications';
import { listUsers } from './users';
import { JUNK_CODES, ctxFor, resetGoTestState, expectJunkIdsInvalidLive, expectValid, expectValidItems, fixtureZoneIds, preSessionFor, withTempDemoState } from './test-support';

withTempDemoState();

// Go reads these from its own environment; the runner shares the same file.
const PASSWORD = process.env['DEMO_EMERGENCY_ADMIN_PASSWORD'] ?? '';
const TOTP = process.env['DEMO_EMERGENCY_ADMIN_TOTP'] ?? '';

const admin = () => ctxFor('administrator');
const pre = (installMode: InstallMode = 'private') => preSessionFor(installMode);
const zones = () => fixtureZoneIds();

const entra = {
  preset_id: 'entra_id_oidc',
  display_name: 'Customer Entra ID',
  is_enabled: true,
  email_domains: ['demo.example'],
  config: { directory_tenant_id: '11111111-2222-4333-8444-555555555555', client_id: '66666666-7777-4888-8999-000000000000' },
  client_secret: 'not-a-real-secret-value',
};

describe('presets (plan section 7)', () => {
  it('lists Entra ID, ADFS, Okta, Google Workspace, Ping Identity, generic OIDC and generic SAML with their fields', async () => {
    const presets = await listIdentityProviderPresets(admin());
    expectValid('IdentityProviderPresetList', presets);
    expect(presets.items.map((p) => p.id)).toEqual(['entra_id_oidc', 'entra_id_saml', 'adfs_saml', 'adfs_oidc', 'okta', 'google_workspace', 'ping_identity', 'generic_oidc', 'generic_saml']);
    const entraOidc = presets.items[0]!;
    expect(entraOidc.notes_en.join(' ')).toMatch(/assigned to the application/i);
    expect(entraOidc.notes_en.join(' ')).toMatch(/object ID/i);
    expect(entraOidc.fields.find((f) => f.key === 'client_secret')).toMatchObject({ secret: true, required: true });
    expect(presets.items.filter((p) => p.protocol === 'saml').every((p) => p.notes_en.some((n) => /signed assertions/i.test(n)))).toBe(true);
  });
});

describe('providers', () => {
  it('starts with the labelled mock provider only, and adds an Entra ID provider from the preset without keeping the secret', async () => {
    const ctx = admin();
    expect((await listIdentityProviders(ctx)).items.map((p) => p.id)).toEqual([MOCK_PROVIDER_ID]);
    const created = await createIdentityProvider(ctx, entra);
    expectValid('IdentityProvider', created);
    expect(created).toMatchObject({ preset_id: 'entra_id_oidc', protocol: 'oidc', has_secret: true, signed_assertions_required: true, read_only: false, claim_mapping: { groups: 'groups' } });
    expect(JSON.stringify(created)).not.toContain('not-a-real-secret-value');
    expect((await listIdentityProviders(ctx)).items).toHaveLength(2);
    expectValid('IdentityProviderList', await listIdentityProviders(ctx));
    expect((await getIdentityProvider(ctx, created.id)).display_name).toBe('Customer Entra ID');
    const audit = (await listAuditEvents(ctx, { action: 'identity_provider.created' })).items[0]!;
    expect(JSON.stringify(audit)).not.toContain('not-a-real-secret-value');
  });

  it('validates the preset fields, the secret, the domains and unknown fields', async () => {
    const ctx = admin();
    await expect(createIdentityProvider(ctx, { ...entra, preset_id: 'nope' })).rejects.toThrow(InvalidInputError);
    await expect(createIdentityProvider(ctx, { ...entra, config: { client_id: 'x' } })).rejects.toThrow(InvalidInputError);
    await expect(createIdentityProvider(ctx, { ...entra, client_secret: undefined })).rejects.toThrow(InvalidInputError);
    await expect(createIdentityProvider(ctx, { ...entra, config: { ...entra.config, unknown_setting: 'x' } })).rejects.toThrow(InvalidInputError);
    await expect(createIdentityProvider(ctx, { ...entra, email_domains: ['not a domain'] })).rejects.toThrow(InvalidInputError);
    await expect(createIdentityProvider(ctx, { ...entra, extra: 1 })).rejects.toThrow(InvalidInputError);
    const saml = await createIdentityProvider(ctx, { preset_id: 'generic_saml', display_name: 'SAML', is_enabled: true, config: { sso_url: 'https://idp.example.com/sso', entity_id: 'https://idp.example.com/meta', signing_certificate: 'MIIBsynthetic'.padEnd(80, 'A') } });
    expect(saml).toMatchObject({ protocol: 'saml', has_secret: false, signed_assertions_required: true });
    expect(saml.claim_mapping.groups).toContain('Group');
  });

  it('tests the connection by script: a filled provider passes, a broken one fails with a reference code', async () => {
    const ctx = admin();
    const good = await createIdentityProvider(ctx, entra);
    const ok = await testIdentityProviderConnection(ctx, good.id);
    expectValid('ConnectionTestResult', ok);
    expect(ok.ok).toBe(true);
    expect(ok.steps.length).toBeGreaterThan(2);
    expect(await getIdentityProvider(ctx, good.id)).toMatchObject({ last_test_ok: true });
    const bad = await createIdentityProvider(ctx, { ...entra, display_name: 'Bad', config: { ...entra.config, client_id: 'invalid-client' } });
    const failed = await testIdentityProviderConnection(ctx, bad.id);
    expect(failed.ok).toBe(false);
    expect(failed.reference_code).toMatch(/^IDP-[0-9A-F]{6}$/);
    expect(await getIdentityProvider(ctx, bad.id)).toMatchObject({ last_test_ok: false });
    expect((await testIdentityProviderConnection(ctx, MOCK_PROVIDER_ID)).ok).toBe(true);
  });

  it('updates and deletes a provider, and keeps the mock provider fixed', async () => {
    const ctx = admin();
    const created = await createIdentityProvider(ctx, entra);
    const updated = await updateIdentityProvider(ctx, created.id, { ...entra, display_name: 'Renamed', client_secret: undefined });
    expect(updated).toMatchObject({ display_name: 'Renamed', has_secret: true });
    await expect(updateIdentityProvider(ctx, created.id, { ...entra, preset_id: 'okta', config: { okta_domain: 'x.okta.com', client_id: 'c' } })).rejects.toThrow(InvalidInputError);
    await expect(updateIdentityProvider(ctx, MOCK_PROVIDER_ID, entra)).rejects.toThrow(ConflictError);
    await expect(deleteIdentityProvider(ctx, MOCK_PROVIDER_ID)).rejects.toThrow(ConflictError);
    await deleteIdentityProvider(ctx, created.id);
    await expect(getIdentityProvider(ctx, created.id)).rejects.toThrow(NotFoundError);
  });

  it('is the Administrator only, view only in a shared install (the vendor sets providers up there)', async () => {
    for (const role of ['dispatch_supervisor', 'planner', 'viewer_auditor', 'change_approver']) {
      await expect(listIdentityProviders(ctxFor(role as 'planner'))).rejects.toThrow(ForbiddenError);
    }
    const shared = ctxFor('administrator', { installMode: 'shared' });
    await expect(listIdentityProviders(shared)).resolves.toBeDefined();
    expect((await listIdentityProviders(shared)).items.every((p) => p.read_only === true)).toBe(true);
    await expect(createIdentityProvider(shared, entra)).rejects.toThrow(ForbiddenError);
    await expect(updateSignInPolicy(shared, { force_sso_email_domains: [], require_mfa_claim: false, allow_local_users_for_outsiders: false, emergency_admin_enabled: true })).rejects.toThrow(ForbiddenError);
    expect((await listAuditEvents(admin(), { outcome: 'denied', action: 'identity_provider.created' })).items).toHaveLength(1);
  });
});

describe('group-to-role rules and the preview', () => {
  it('lists the fixture rules, and a person whose groups match no rule gets no access and never a default role', async () => {
    const ctx = admin();
    const rules = await listRoleMappings(ctx);
    expectValid('RoleMappingList', rules);
    expect(rules.items).toHaveLength(fixtureRecords<RoleMapping>('RoleMapping').length);
    const none = await previewRoleMappings(ctx, { groups: ['marketing', 'everyone'] });
    expectValid('RoleMappingPreview', none);
    expect(none).toEqual({ assigned_role: null, zone_ids: [], matched_mapping_ids: [] });
    expect(await previewRoleMappings(ctx, { groups: [] })).toEqual({ assigned_role: null, zone_ids: [], matched_mapping_ids: [] });
    const admins = await previewRoleMappings(ctx, { groups: ['opendispatch-administrators'] });
    expect(admins.assigned_role).toBe('administrator');
    expect(admins.matched_mapping_ids).toHaveLength(1);
  });

  it('maps a group by object ID to a role and zones, and merges the zones of rules with the same role', async () => {
    const ctx = admin();
    const first = await createRoleMapping(ctx, { group_match: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', group_match_type: 'object_id', assigned_role: 'dispatcher', zone_ids: [zones()[5] as string], priority: 20 });
    expectValid('RoleMapping', first);
    await createRoleMapping(ctx, { group_match: 'dispatch-north', group_match_type: 'prefix', assigned_role: 'dispatcher', zone_ids: [zones()[6] as string], priority: 21 });
    const preview = await previewRoleMappings(ctx, { groups: ['3F2504E0-4F89-41D3-9A0C-0305E82C3301', 'dispatch-north-team'] });
    expect(preview.assigned_role).toBe('dispatcher');
    expect([...preview.zone_ids].sort()).toEqual([zones()[5] as string, zones()[6] as string].sort());
    expect(preview.matched_mapping_ids).toHaveLength(2);
    await expect(createRoleMapping(ctx, { group_match: 'not-a-guid', group_match_type: 'object_id', assigned_role: 'planner', zone_ids: [zones()[0] as string] })).rejects.toThrow(InvalidInputError);
    await expect(createRoleMapping(ctx, { group_match: 'g', group_match_type: 'exact', assigned_role: 'planner' })).rejects.toThrow(InvalidInputError);
    await expect(createRoleMapping(ctx, { group_match: 'g', group_match_type: 'exact', assigned_role: 'boss' })).rejects.toThrow(InvalidInputError);
    await expect(createRoleMapping(ctx, { group_match: 'g', group_match_type: 'exact', assigned_role: 'viewer_auditor', identity_provider_id: 'unknown-provider' })).rejects.toThrow(NotFoundError);
  });

  it('applies the lowest priority number first, ignores disabled rules, and edits and deletes rules (audited)', async () => {
    const ctx = admin();
    const low = await createRoleMapping(ctx, { group_match: 'shared-group', group_match_type: 'exact', assigned_role: 'viewer_auditor', priority: 50 });
    const high = await createRoleMapping(ctx, { group_match: 'shared-group', group_match_type: 'exact', assigned_role: 'administrator', priority: 5 });
    expect((await previewRoleMappings(ctx, { groups: ['shared-group'] })).assigned_role).toBe('administrator');
    await updateRoleMapping(ctx, high.id, { group_match: 'shared-group', group_match_type: 'exact', assigned_role: 'administrator', priority: 5, is_enabled: false });
    expect(await previewRoleMappings(ctx, { groups: ['shared-group'] })).toMatchObject({ assigned_role: 'viewer_auditor', matched_mapping_ids: [low.id] });
    await deleteRoleMapping(ctx, low.id);
    expect((await previewRoleMappings(ctx, { groups: ['shared-group'] })).assigned_role).toBeNull();
    const actions = (await listAuditEvents(ctx, { limit: 30 })).items.map((e) => e.action);
    for (const action of ['role_mapping.created', 'role_mapping.updated', 'role_mapping.deleted']) expect(actions).toContain(action);
  });

  it('ignores a rule for a role that does not exist in the install mode (Change Approver in a shared install)', async () => {
    const shared = ctxFor('administrator', { installMode: 'shared' });
    const rule = fixtureRecords<RoleMapping>('RoleMapping').find((m) => m.assigned_role === 'change_approver');
    expect(rule).toBeDefined();
    expect((await previewRoleMappings(admin(), { groups: [rule!.group_match] })).assigned_role).toBe('change_approver');
    expect((await previewRoleMappings(shared, { groups: [rule!.group_match] })).assigned_role).toBeNull();
  });

  it('allows the preview to the Administrator only', async () => {
    await expect(previewRoleMappings(ctxFor('planner'), { groups: [] })).rejects.toThrow(ForbiddenError);
    await expect(listRoleMappings(ctxFor('viewer_auditor'))).rejects.toThrow(ForbiddenError);
    await expect(createRoleMapping(ctxFor('planner'), { group_match: 'g', group_match_type: 'exact', assigned_role: 'viewer_auditor' })).rejects.toThrow(ForbiddenError);
  });
});

describe('sign-in policy', () => {
  it('reads the fixture defaults, updates them and audits', async () => {
    const ctx = admin();
    const policy = await getSignInPolicy(ctx);
    expectValid('SignInPolicy', policy);
    expect(policy).toMatchObject({ require_mfa_claim: false, allow_local_users_for_outsiders: false, emergency_admin_enabled: true });
    const next = await updateSignInPolicy(ctx, { force_sso_email_domains: ['demo.example', 'customer.example'], require_mfa_claim: true, allow_local_users_for_outsiders: false, emergency_admin_enabled: true });
    expect(next.require_mfa_claim).toBe(true);
    expect((await getSignInPolicy(ctx)).force_sso_email_domains).toEqual(['demo.example', 'customer.example']);
    await expect(updateSignInPolicy(ctx, { force_sso_email_domains: ['bad domain'], require_mfa_claim: true, allow_local_users_for_outsiders: false, emergency_admin_enabled: true })).rejects.toThrow(InvalidInputError);
    expect((await listAuditEvents(ctx, { action: 'sign_in_policy.updated' })).items).toHaveLength(1);
  });
});

describe('mock provider sign-in (demo only)', () => {
  it('signs a person in from their groups, creates the account at first sign-in and audits it', async () => {
    const ctx = admin();
    const result = await mockSignIn(pre(), { provider_id: MOCK_PROVIDER_ID, subject: 'huda.test@demo.example', groups: ['opendispatch-administrators'] });
    expectValid('SignInResult', result);
    expect(result).toMatchObject({ outcome: 'signed_in', is_mock: true, assigned_role: 'administrator', zone_ids: [] });
    const created = (await listUsers(ctx, { q: 'huda.test' })).items[0]!;
    expect(created).toMatchObject({ status: 'active', keycloak_subject: 'huda.test@demo.example', assigned_role: 'administrator' });
    const event = (await listAuditEvents(ctx, { action: 'auth.mock_sign_in' })).items[0]!;
    expect(event).toMatchObject({ outcome: 'success', actor_type: 'demo', actor_user_id: created.id });
    // roles are recalculated at every sign-in
    await createRoleMapping(ctx, { group_match: 'temp-viewers', group_match_type: 'exact', assigned_role: 'viewer_auditor', priority: 1 });
    const again = await mockSignIn(pre(), { provider_id: MOCK_PROVIDER_ID, subject: 'huda.test@demo.example', groups: ['temp-viewers'] });
    expect(again).toMatchObject({ outcome: 'signed_in', assigned_role: 'viewer_auditor', user_id: created.id });
    expect((await listUsers(ctx, { q: 'huda.test' })).items).toHaveLength(1);
  });

  it('gives no access when no rule matches: nothing is created and the refusal is audited', async () => {
    const ctx = admin();
    const before = (await listUsers(ctx, { limit: 200 })).page.total;
    const result = await mockSignIn(pre(), { provider_id: MOCK_PROVIDER_ID, subject: 'nobody@demo.example', groups: ['random-group'] });
    expect(result).toMatchObject({ outcome: 'no_role_assigned', is_mock: true, assigned_role: null, zone_ids: [] });
    expect(result.reference_code).toMatch(/^ODP-/);
    expect((await listUsers(ctx, { limit: 200 })).page.total).toBe(before);
    expect((await listAuditEvents(ctx, { action: 'auth.mock_sign_in', outcome: 'denied' })).items).toHaveLength(1);
  });

  it('refuses an unknown provider and a disabled account, and never takes a role from the request', async () => {
    expect((await mockSignIn(pre(), { provider_id: 'unknown', subject: 's', groups: ['opendispatch-administrators'] })).outcome).toBe('refused_by_provider');
    const disabled = fixtureRecords<User>('User').find((u) => u.status === 'disabled')!;
    expect((await mockSignIn(pre(), { provider_id: MOCK_PROVIDER_ID, subject: disabled.email, groups: ['opendispatch-administrators'] })).outcome).toBe('locked');
    await expect(mockSignIn(pre(), { provider_id: MOCK_PROVIDER_ID, subject: 's', groups: [], role: 'administrator' })).rejects.toThrow(InvalidInputError);
  });
});

describe('emergency administrator sign-in', () => {
  const email = () => fixtureRecords<User>('User').find((u) => u.is_emergency_admin)!.email;

  beforeEach(async () => {
    await resetGoTestState();
  });

  it('asks for the authenticator code, then signs in, audits it and raises the alert', async () => {
    const ctx = ctxFor('viewer_auditor');
    const unread = (await countUnreadNotifications(ctx));
    expect(await emergencyAdminSignIn(pre(), { email: email(), password: PASSWORD })).toMatchObject({ outcome: 'mfa_required', is_mock: false });
    const done = await emergencyAdminSignIn(pre(), { email: email(), password: PASSWORD, totp_code: TOTP });
    expectValid('SignInResult', done);
    expect(done).toMatchObject({ outcome: 'signed_in', assigned_role: 'administrator', is_mock: false });
    const event = (await listAuditEvents(admin(), { action: 'auth.emergency_admin_sign_in', outcome: 'success' })).items[0]!;
    expect(event).toMatchObject({ actor_type: 'emergency_admin', actor_user_id: done.user_id });
    expect((await countUnreadNotifications(ctx))).toBeGreaterThan(unread);
  });

  it('refuses a wrong password or code, locks after five failures, and refuses everything without the environment', async () => {
    const ctx = admin();
    expect((await emergencyAdminSignIn(pre(), { email: email(), password: 'wrong' })).outcome).toBe('invalid_credentials');
    expect((await emergencyAdminSignIn(pre(), { email: email(), password: PASSWORD, totp_code: '000000' })).outcome).toBe('invalid_credentials');
    expect((await emergencyAdminSignIn(pre(), { email: 'someone@else.example', password: 'x' })).outcome).toBe('invalid_credentials');
    for (let i = 0; i < 3; i += 1) await emergencyAdminSignIn(pre(), { email: email(), password: 'wrong' });
    expect((await emergencyAdminSignIn(pre(), { email: email(), password: PASSWORD, totp_code: TOTP })).outcome).toBe('locked');
    expect((await listAuditEvents(ctx, { action: 'auth.emergency_admin_sign_in', outcome: 'failure' })).items.length).toBeGreaterThan(0);
  });

  it('can be switched off in the sign-in policy', async () => {
    const ctx = admin();
    await updateSignInPolicy(ctx, { force_sso_email_domains: [], require_mfa_claim: false, allow_local_users_for_outsiders: false, emergency_admin_enabled: false });
    expect((await emergencyAdminSignIn(pre(), { email: email(), password: PASSWORD, totp_code: TOTP })).outcome).toBe('invalid_credentials');
  });
});

describe('session', () => {
  it('describes the caller from the server side only and validates against the contract', async () => {
    for (const role of ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      const ctx = ctxFor(role);
      const session = await getSessionContext(ctx);
      expectValid('SessionContext', session);
      expect(session).toMatchObject({ install_mode: 'private', is_demo: true, tenant: { id: ctx.customerId }, user: { id: ctx.userId, assigned_role: role } });
      expect(session.modules).toHaveLength(30);
    }
    const supervisor = await getSessionContext(ctxFor('dispatch_supervisor'));
    expect(supervisor.modules.find((m) => m.module_id === 'admin.classification_rules')).toMatchObject({ access: 'view', can_approve: true });
    expect((await getSessionContext(ctxFor('dispatcher', { zones: [zones()[0] as string] }))).user.zone_ids).toEqual([zones()[0]]);
    expectValidItems('ModuleAccess', supervisor.modules);
    await expect(getSessionContext(ctxFor('change_approver', { installMode: 'shared' }))).rejects.toThrow(ForbiddenError);
  });

  it('records the sign-out', async () => {
    const ctx = ctxFor('planner');
    await signOut(ctx);
    expect((await listAuditEvents(admin(), { action: 'auth.sign_out' })).items[0]).toMatchObject({ actor_user_id: ctx.userId });
  });

  it('persists a provider between calls and resets to the mock provider only', async () => {
    const ctx = admin();
    const created = await createIdentityProvider(ctx, entra);
    expect((await getIdentityProvider(ctx, created.id)).display_name).toBe('Customer Entra ID');
    await resetGoTestState();
    expect((await listIdentityProviders(ctx)).items.map((p) => p.id)).toEqual([MOCK_PROVIDER_ID]);
  });
});

// ---------------------------------------------------------------------------------------------
// Before sign-in (the pre-session context
// ---------------------------------------------------------------------------------------------

describe('sign-in before anyone has signed in (PreSessionContext)', () => {
  const emergencyEmail = () => fixtureRecords<User>('User').find((u) => u.is_emergency_admin)!.email;

  beforeEach(async () => {
    await resetGoTestState();
  });

  it('lets a signed-out visitor call both sign-in functions, in every install mode', async () => {
    for (const mode of ['private', 'dedicated', 'shared'] as const) {
      const visitor = pre(mode);
      expect(visitor).toEqual({ customerId: admin().customerId, installMode: mode });
      expect(Object.keys(visitor).sort()).toEqual(['customerId', 'installMode']);
      expect(await mockSignIn(visitor, { provider_id: MOCK_PROVIDER_ID, subject: `visitor-${mode}@demo.example`, groups: ['opendispatch-administrators'] })).toMatchObject({ outcome: 'signed_in', assigned_role: 'administrator' });
      expect(await emergencyAdminSignIn(visitor, { email: emergencyEmail(), password: PASSWORD })).toMatchObject({ outcome: 'mfa_required' });
    }
  });

  it('refuses a RequestContext, even one with a made-up role: no default role for a signed-out visitor', async () => {
    const before = (await listAuditEvents(admin(), { limit: 200 })).page.total;
    for (const role of ['viewer_auditor', 'administrator', 'planner'] as const) {
      const someone = ctxFor(role);
      // @ts-expect-error a RequestContext is not a PreSessionContext: the type refuses it, and so does the guard at run time
      await expect(mockSignIn(someone, { provider_id: MOCK_PROVIDER_ID, subject: 's', groups: ['opendispatch-administrators'] })).rejects.toThrow(ForbiddenError);
      // @ts-expect-error the same for the emergency sign-in
      await expect(emergencyAdminSignIn(someone, { email: emergencyEmail(), password: 'x' })).rejects.toThrow(ForbiddenError);
    }
    // a made-up context assembled by hand is refused too: a role, a user or a zone scope field, an unknown customer, an install mode that does not exist
    const forged = [
      { ...pre(), role: 'viewer_auditor' },
      { ...pre(), userId: admin().userId },
      { ...pre(), zoneScope: { kind: 'whole_install' } },
      { customerId: '00000000-0000-4000-8000-000000000000', installMode: 'private' },
      { customerId: admin().customerId, installMode: 'cloud' },
      { customerId: admin().customerId },
      null,
      'private',
    ];
    for (const context of forged) {
      await expect(mockSignIn(context as never, { provider_id: MOCK_PROVIDER_ID, subject: 's', groups: [] }), JSON.stringify(context)).rejects.toThrow(ForbiddenError);
      await expect(emergencyAdminSignIn(context as never, { email: emergencyEmail(), password: 'x' }), JSON.stringify(context)).rejects.toThrow(ForbiddenError);
    }
    // nothing was signed in, created or audited on the way (no person, so no event)
    expect((await listAuditEvents(admin(), { action: 'auth.mock_sign_in' })).items).toHaveLength(0);
    expect((await listAuditEvents(admin(), { limit: 200 })).page.total).toBe(before);
    expect((await listUsers(admin(), { q: 'visitor-' })).items).toHaveLength(0);
  });

  it('cannot be used to call anything else: every other operation refuses a pre-session context', async () => {
    const visitor = pre() as never;
    await expect(getSessionContext(visitor)).rejects.toThrow(ForbiddenError);
    await expect(listUsers(visitor)).rejects.toThrow();
    await expect(listAuditEvents(visitor)).rejects.toThrow(ForbiddenError);
    await expect(listIdentityProviders(visitor)).rejects.toThrow();
    await expect(previewRoleMappings(visitor, { groups: ['opendispatch-administrators'] })).rejects.toThrow();
    await expect(updateSignInPolicy(visitor, { force_sso_email_domains: [], require_mfa_claim: false, allow_local_users_for_outsiders: false, emergency_admin_enabled: false })).rejects.toThrow();
    await expect(createRoleMapping(visitor, { group_match: 'x', group_match_type: 'exact', assigned_role: 'administrator' })).rejects.toThrow();
    await expect(signOut(visitor)).rejects.toThrow(ForbiddenError);
    expect((await getSignInPolicy(admin())).emergency_admin_enabled).toBe(true);
    expect((await listRoleMappings(admin(), { limit: 200 })).items.some((m) => m.group_match === 'x')).toBe(false);
  });

  it('never takes a role, zone, user or customer from the body: the role comes from the group rules', async () => {
    for (const extra of [{ role: 'administrator' }, { assigned_role: 'administrator' }, { zone_ids: zones() }, { user_id: admin().userId }, { customer_id: admin().customerId }, { install_mode: 'private' }]) {
      await expect(mockSignIn(pre(), { provider_id: MOCK_PROVIDER_ID, subject: 's', groups: [], ...extra })).rejects.toThrow(InvalidInputError);
      await expect(emergencyAdminSignIn(pre(), { email: emergencyEmail(), password: 'x', ...extra })).rejects.toThrow(InvalidInputError);
    }
    // a person in a planner group gets the planner role and the zones of the rule, whatever the caller's install mode says
    await createRoleMapping(admin(), { group_match: 'opendispatch-planners', group_match_type: 'exact', assigned_role: 'planner', zone_ids: [zones()[0] as string], priority: 1 });
    expect(await mockSignIn(pre(), { provider_id: MOCK_PROVIDER_ID, subject: 'p.lanner@demo.example', groups: ['opendispatch-planners'] })).toMatchObject({ outcome: 'signed_in', assigned_role: 'planner', zone_ids: [zones()[0]] });
  });

  it('records no actor and no creator for what nobody signed in to do: a failure, a refusal, an account created at first sign-in', async () => {
    const seen = new Set((await listAuditEvents(admin(), { limit: 200 })).items.map((e) => e.id));
    const fresh = async () => (await listAuditEvents(admin(), { limit: 200 })).items.filter((e) => !seen.has(e.id));
    await mockSignIn(pre(), { provider_id: 'unknown', subject: 'nobody', groups: [] });
    await mockSignIn(pre(), { provider_id: MOCK_PROVIDER_ID, subject: 'stranger@demo.example', groups: ['random-group'] });
    await emergencyAdminSignIn(pre(), { email: 'someone@else.example', password: 'x' });
    const events = await fresh();
    expect(events).toHaveLength(3);
    for (const event of events) expect(event.actor_user_id, event.summary_en).toBeNull();
    expect(events.map((e) => e.outcome).sort()).toEqual(['denied', 'denied', 'failure']);
    // a wrong password for the real emergency account still names that account (unchanged): the attempt is about it
    await emergencyAdminSignIn(pre(), { email: emergencyEmail(), password: 'wrong' });
    expect((await fresh()).find((e) => e.summary_en.includes('wrong password'))?.actor_user_id).toBe(fixtureRecords<User>('User').find((u) => u.is_emergency_admin)!.id);
    // a first sign-in creates the account with no creator (nobody was signed in), and the success event names the person who signed in
    const result = await mockSignIn(pre(), { provider_id: MOCK_PROVIDER_ID, subject: 'first.timer@demo.example', groups: ['opendispatch-administrators'] });
    const created = (await listUsers(admin(), { q: 'first.timer' })).items[0]!;
    expect(created.created_by).toBeNull();
    expect(created.data_source).toBe('SYNTHETIC');
    expect(result.user_id).toBe(created.id);
    expect((await listAuditEvents(admin(), { action: 'auth.mock_sign_in', outcome: 'success' })).items[0]).toMatchObject({ actor_user_id: created.id, actor_type: 'demo', created_by: null });
  });

  it('follows the install mode of the visitor: a group rule for Change Approver gives no access in a shared install', async () => {
    await createRoleMapping(admin(), { group_match: 'opendispatch-change-approvers', group_match_type: 'exact', assigned_role: 'change_approver', priority: 1 });
    expect(await mockSignIn(pre('private'), { provider_id: MOCK_PROVIDER_ID, subject: 'c.a@demo.example', groups: ['opendispatch-change-approvers'] })).toMatchObject({ outcome: 'signed_in', assigned_role: 'change_approver' });
    expect(await mockSignIn(pre('shared'), { provider_id: MOCK_PROVIDER_ID, subject: 'c.b@demo.example', groups: ['opendispatch-change-approvers'] })).toMatchObject({ outcome: 'no_role_assigned', assigned_role: null });
  });

  it('raises the emergency-administrator alert with no user on it (the customer only) and honours the policy switch', async () => {
    const unread = (await countUnreadNotifications(admin()));
    expect(await emergencyAdminSignIn(pre(), { email: emergencyEmail(), password: PASSWORD, totp_code: TOTP })).toMatchObject({ outcome: 'signed_in', assigned_role: 'administrator' });
    expect((await countUnreadNotifications(admin()))).toBeGreaterThan(unread);
    const alert = (await listMyNotificationsFor('administrator')).find((n) => n.title_en.startsWith('Emergency administrator'))!;
    expect(alert).toMatchObject({ created_by: null, data_source: 'SYNTHETIC', category: 'security' });
    await updateSignInPolicy(admin(), { force_sso_email_domains: [], require_mfa_claim: false, allow_local_users_for_outsiders: false, emergency_admin_enabled: false });
    expect((await emergencyAdminSignIn(pre(), { email: emergencyEmail(), password: PASSWORD, totp_code: TOTP })).outcome).toBe('invalid_credentials');
  });

  it('still records the sign-out of a person who has a session (signOut keeps the RequestContext)', async () => {
    await signOut(ctxFor('viewer_auditor'));
    expect((await listAuditEvents(admin(), { action: 'auth.sign_out' })).items[0]).toMatchObject({ actor_user_id: ctxFor('viewer_auditor').userId });
  });
});

async function listMyNotificationsFor(role: 'administrator') {
  return (await listNotificationLog(admin(), { limit: 200 })).items.filter((n) => n.recipient_role === role);
}

// ---------------------------------------------------------------------------------------------
// DG13 (a scripted "the provider failed") and DG14 (a code on every connection test step)
// ---------------------------------------------------------------------------------------------

describe('scripted provider failure (DG13)', () => {
  it('answers outcome error with a reference code for the subject provider.error, whatever the groups, and audits it as a failure', async () => {
    const visitor = pre();
    for (const groups of [[], ['opendispatch-administrators']]) {
      const result = await mockSignIn(visitor, { provider_id: MOCK_PROVIDER_ID, subject: 'provider.error', groups });
      expectValid('SignInResult', result);
      expect(result).toMatchObject({ outcome: 'error', is_mock: true, assigned_role: null, zone_ids: [] });
      expect(result.reference_code).toMatch(/^ODP-[0-9A-F]{8}$/);
      expect(result.user_id ?? null).toBeNull();
    }
    expect((await mockSignIn(visitor, { provider_id: MOCK_PROVIDER_ID, subject: 'Provider.Error', groups: ['opendispatch-administrators'] })).outcome).toBe('error');
    const events = (await listAuditEvents(admin(), { action: 'auth.mock_sign_in', outcome: 'failure' })).items;
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ actor_type: 'demo', actor_user_id: null });
    // no account is created by a provider failure, and the reference code is stable for the same input
    expect((await listUsers(admin(), { q: 'provider.error' })).items).toHaveLength(0);
    expect((await mockSignIn(visitor, { provider_id: MOCK_PROVIDER_ID, subject: 'provider.error', groups: [] })).reference_code).toBe((await mockSignIn(visitor, { provider_id: MOCK_PROVIDER_ID, subject: 'provider.error', groups: [] })).reference_code);
  });

  it('does not trigger on other subjects that only look alike', async () => {
    for (const subject of ['provider.errors', 'xprovider.error', 'provider-error']) {
      expect((await mockSignIn(pre(), { provider_id: MOCK_PROVIDER_ID, subject, groups: ['opendispatch-administrators'] })).outcome).toBe('signed_in');
    }
  });
});

describe('connection test step codes (DG14)', () => {
  const CODES = ['reach', 'discovery', 'client', 'claims', 'saml', 'signed', 'attrs'];

  it('gives every step of an OIDC test a code: reach, discovery, client, claims', async () => {
    const ctx = admin();
    const provider = await createIdentityProvider(ctx, entra);
    const result = await testIdentityProviderConnection(ctx, provider.id);
    expectValid('ConnectionTestResult', result);
    expect(result.steps.map((s) => s.code)).toEqual(['reach', 'discovery', 'client', 'claims']);
    expect(result.steps.map((s) => s.name).every((name) => name.length > 0)).toBe(true);
  });

  it('gives every step of a SAML test a code: reach, saml, signed, attrs', async () => {
    const ctx = admin();
    const provider = await createIdentityProvider(ctx, { preset_id: 'adfs_saml', display_name: 'ADFS', is_enabled: true, config: { metadata_url: 'https://adfs.example.com/FederationMetadata/2007-06/FederationMetadata.xml' } });
    const result = await testIdentityProviderConnection(ctx, provider.id);
    expectValid('ConnectionTestResult', result);
    expect(result.steps.map((s) => s.code)).toEqual(['reach', 'saml', 'signed', 'attrs']);
  });

  it('keeps the step codes to the seven the screens translate, also for a failed test and for the mock provider', async () => {
    const ctx = admin();
    const bad = await createIdentityProvider(ctx, { ...entra, display_name: 'Bad', config: { ...entra.config, client_id: 'invalid-client' } });
    const failed = await testIdentityProviderConnection(ctx, bad.id);
    expect(failed.ok).toBe(false);
    expect(failed.steps.find((s) => s.code === 'reach')).toMatchObject({ ok: false });
    for (const step of [...failed.steps, ...(await testIdentityProviderConnection(ctx, MOCK_PROVIDER_ID)).steps]) expect(CODES).toContain(step.code);
  });
});

// ---------------------------------------------------------------------------------------------
// DG5: "Request a change" (Sign-in and Identity, shared installs)
// ---------------------------------------------------------------------------------------------

describe('request a change to the identity providers (DG5)', () => {
  const snapshot = async () => JSON.stringify([await listIdentityProviders(admin()), await listRoleMappings(admin()), await countUnreadNotifications(admin())]);
  const asks = { provider_id: null, change: 'Please add our second Entra ID tenant and map the group opendispatch-planners to Planner.' };

  it('lets the Administrator of a shared install, who may only view providers, send a request: a receipt, an audit event and an alert for the Administrators', async () => {
    const shared = ctxFor('administrator', { installMode: 'shared' });
    await expect(createIdentityProvider(shared, entra)).rejects.toThrow(ForbiddenError); // view only here
    const unread = (await countUnreadNotifications(shared));
    const receipt = await requestIdentityProviderChange(shared, asks);
    expectValid('IdentityProviderChangeReceipt', receipt);
    expect(receipt.reference_code).toMatch(/^CHG-[0-9A-F]{8}$/);
    expect(receipt.requested_at).toMatch(/\+03:00$/);
    const event = (await listAuditEvents(shared, { action: 'identity.change_requested' })).items[0]!;
    expect(event).toMatchObject({ outcome: 'success', actor_user_id: shared.userId, entity_type: 'identity_provider', detail: { reference_code: receipt.reference_code, provider_id: null } });
    expect(event.summary_en).not.toContain('Entra');
    expect((await countUnreadNotifications(shared))).toBe(unread + 1);
    const alert = (await listMyNotifications(shared, { unread_only: true })).items[0]!;
    expect(alert).toMatchObject({ category: 'security', severity: 'info', recipient_role: 'administrator', recipient_user_id: null, is_read: false, data_source: 'SYNTHETIC', created_by: shared.userId, link_path: '/admin/sign-in-identity' });
    expect(alert.body_en).toContain(receipt.reference_code);
    // nothing about the providers changed
    expect((await listIdentityProviders(shared)).items.map((p) => p.id)).toEqual([MOCK_PROVIDER_ID]);
  });

  it('works in the other install modes too, and about one provider that exists', async () => {
    for (const installMode of ['private', 'dedicated'] as const) {
      expect((await requestIdentityProviderChange(ctxFor('administrator', { installMode }), { provider_id: MOCK_PROVIDER_ID, change: 'Disable it.' })).reference_code).toMatch(/^CHG-/);
    }
    const ctx = admin();
    const created = await createIdentityProvider(ctx, entra);
    expect((await requestIdentityProviderChange(ctx, { provider_id: created.id, change: 'Rotate the client secret.' })).reference_code).toMatch(/^CHG-/);
    await expect(requestIdentityProviderChange(ctx, { provider_id: 'no-such-provider', change: 'x' })).rejects.toThrow(NotFoundError);
    expect((await listAuditEvents(ctx, { action: 'identity.change_requested', limit: 200 })).items).toHaveLength(3);
  });

  it('gives a different reference code to each request', async () => {
    const a = await requestIdentityProviderChange(admin(), { change: 'One.' });
    const b = await requestIdentityProviderChange(admin(), { change: 'Two.' });
    expect(a.reference_code).not.toBe(b.reference_code);
  });

  it('checks the text (1 to 1000 characters), the provider id, and refuses any other field', async () => {
    const ctx = admin();
    for (const bad of [{}, { change: '' }, { change: 'a'.repeat(1001) }, { change: 5 }, { change: 'x', role: 'administrator' }, { change: 'x', provider_id: 5 }, { change: 'x', provider_id: 'a'.repeat(129) }, null, 'text']) {
      await expect(requestIdentityProviderChange(ctx, bad), JSON.stringify(bad)).rejects.toThrow(InvalidInputError);
    }
    expect((await requestIdentityProviderChange(ctx, { change: 'a'.repeat(1000) })).reference_code).toMatch(/^CHG-/);
    await expectJunkIdsInvalidLive((id) => requestIdentityProviderChange(ctx, { provider_id: id, change: 'x' }), JUNK_CODES.filter((id) => id !== null && id !== undefined));
  });

  it('is for whoever may view the module, the Administrator: every other role is forbidden, the denial is audited, and nothing is raised', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      const before = await snapshot();
      const audits = (await listAuditEvents(admin(), { limit: 1 })).page.total ?? 0;
      await expect(requestIdentityProviderChange(ctxFor(role), asks), role).rejects.toThrow(ForbiddenError);
      expect(await snapshot()).toBe(before);
      expect((await listAuditEvents(admin(), { limit: 1 })).page.total).toBe(audits + 1);
    }
    expect((await listAuditEvents(admin(), { action: 'identity.change_requested', outcome: 'denied', limit: 200 })).items).toHaveLength(6);
    await expect(requestIdentityProviderChange(ctxFor('planner'), 'nonsense')).rejects.toThrow(ForbiddenError); // the role check comes first
    await expect(requestIdentityProviderChange(ctxFor('change_approver', { installMode: 'shared' }), asks)).rejects.toThrow(UnauthenticatedError); // Go: no such session
  });
});
