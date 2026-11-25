'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Sign-in and Identity screen: exactly the data functions of lib/data/identity.ts.
//
//   saveProvider           createIdentityProvider / updateIdentityProvider   (a new provider starts disabled, see below)
//   saveAndTestProvider    saveProvider, then testIdentityProviderConnection (LABELLED STUB: scripted, nothing is contacted)
//   testProvider           testIdentityProviderConnection                    (LABELLED STUB)
//   setProviderEnabled     updateIdentityProvider                            (enable and disable)
//   removeProvider         deleteIdentityProvider                            (only used to throw away a draft the wizard made)
//   saveRule / setRuleEnabled / removeRule   createRoleMapping / updateRoleMapping / deleteRoleMapping
//   previewRules           previewRoleMappings                               (a read: nothing is written or audited)
//   saveSignInPolicy       updateSignInPolicy, then updateSessionPolicy      (in that order: see below)
//   setEmergencySignIn     updateSignInPolicy                                (the emergency administrator switch)
//   requestChange          requestIdentityProviderChange                     (shared installs: "Request a change", nothing is sent)
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. The role a rule
// gives is `assigned_role`. A client secret typed into the wizard is forwarded to the data layer, which keeps only the fact that
// one was given; this file never logs, returns or stores it.
//
// The wizard tests a provider the data layer already holds (the test runs on a stored provider), so the first test of a NEW
// provider creates it disabled; "Save provider" then enables it, and closing the wizard first removes the draft.
//
// The sign-in policy tab also holds the session length, which lives in the Security module's session policy. saveSignInPolicy
// writes the sign-in policy FIRST: in a shared install that write is refused (the tab is read only there), so nothing is
// changed by the second one, which the Administrator could otherwise still do.

import { pickFields, pickText, pickTextList } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { ForbiddenError, InvalidInputError, NotFoundError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import {
  createIdentityProvider,
  createRoleMapping,
  deleteIdentityProvider,
  deleteRoleMapping,
  getIdentityProvider,
  getSignInPolicy,
  listRoleMappings,
  requestIdentityProviderChange,
  testIdentityProviderConnection,
  updateIdentityProvider,
  updateRoleMapping,
  updateSignInPolicy,
} from '@/lib/data/identity';
import { getSessionPolicy, updateSessionPolicy } from '@/lib/data/system';
import type { ConnectionTestResult, IdentityProvider } from '@/lib/types';
import type { ChangeReceipt, ChangeRequestInput, EmergencyInput, PolicyInput, PolicySaved, PreviewInput, PreviewResult, ProviderEnabledInput, ProviderInput, ProviderSaved, ProviderTarget, ProviderTested, RuleEnabledInput, RuleInput, RuleSaved, RuleTarget, TestOutcome } from './types';
import { previewGroups, zoneCodeMap } from './view';

const REVALIDATE = '/admin/sign-in-identity';
/** The preview takes at most this many groups; each is at most 256 characters (the data layer's limit). */
const MAX_GROUPS = 50;

/**
 * A read the write needs first (the provider's settings, the rule's provider). A role that may not even read is refused by the
 * write itself, so the refused attempt leaves its `denied` event instead of failing earlier with nothing written.
 */
async function readFirstAsync<T>(read: () => Promise<T>, refuse: () => Promise<unknown>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError) await refuse();
    throw error;
  }
}

const savedOf = (provider: IdentityProvider): ProviderSaved => ({ id: provider.id, name: provider.display_name, enabled: provider.is_enabled });

function outcomeOf(result: ConnectionTestResult): TestOutcome {
  return {
    ok: result.ok,
    checkedAt: result.checked_at,
    referenceCode: result.reference_code ?? null,
    steps: result.steps.map((step) => ({ code: step.code ?? null, name: step.name, ok: step.ok, message: step.message ?? null })),
  };
}

/** The body of a provider write: the person's fields, and the enabled state the caller decides. Only named keys are forwarded. */
function providerBody(input: unknown, isEnabled: boolean): Record<string, unknown> {
  const fields = pickFields(input, ['preset_id', 'display_name', 'email_domains', 'config', 'client_secret', 'claim_mapping']);
  const secret = typeof fields.client_secret === 'string' && fields.client_secret !== '' ? { client_secret: fields.client_secret } : {};
  return {
    preset_id: fields.preset_id,
    display_name: fields.display_name,
    is_enabled: isEnabled,
    email_domains: fields.email_domains,
    config: fields.config,
    claim_mapping: fields.claim_mapping,
    ...secret,
  };
}

async function writeProvider(ctx: RequestContext, input: unknown): Promise<IdentityProvider> {
  const providerId = pickText(input, 'providerId');
  // A change keeps the provider's enabled state; a new provider starts disabled until the wizard's last step enables it.
  if (providerId === undefined) return await createIdentityProvider(ctx, providerBody(input, false));
  const current = await readFirstAsync(() => getIdentityProvider(ctx, providerId), () => updateIdentityProvider(ctx, providerId, {}));
  return await updateIdentityProvider(ctx, providerId, providerBody(input, current.is_enabled));
}

/** Adds or changes a provider from the wizard's fields. */
export async function saveProvider(input: ProviderInput): Promise<ActionResult<ProviderSaved>> {
  return runAction(async (ctx) => savedOf(await writeProvider(ctx, input)), { revalidate: REVALIDATE });
}

/** LABELLED STUB: saves the wizard's fields, then runs the scripted connection test on the saved provider. */
export async function saveAndTestProvider(input: ProviderInput): Promise<ActionResult<ProviderTested>> {
  return runAction(
    async (ctx) => {
      const provider = await writeProvider(ctx, input);
      return { provider: savedOf(provider), test: outcomeOf(await testIdentityProviderConnection(ctx, provider.id)) } satisfies ProviderTested;
    },
    { revalidate: REVALIDATE },
  );
}

/** LABELLED STUB: the scripted connection test of a provider that is already saved. */
export async function testProvider(input: ProviderTarget): Promise<ActionResult<TestOutcome>> {
  return runAction(async (ctx) => outcomeOf(await testIdentityProviderConnection(ctx, pickText(input, 'providerId') ?? '')), { revalidate: REVALIDATE });
}

/** Enables or disables a provider: the same settings, another `is_enabled`. */
export async function setProviderEnabled(input: ProviderEnabledInput): Promise<ActionResult<ProviderSaved>> {
  return runAction(
    async (ctx) => {
      const providerId = pickText(input, 'providerId') ?? '';
      const enabled = pickFields(input, ['enabled']).enabled;
      if (typeof enabled !== 'boolean') throw new InvalidInputError('Provider: say whether it is enabled.');
      const existing = await readFirstAsync(() => getIdentityProvider(ctx, providerId), () => updateIdentityProvider(ctx, providerId, {}));
      const body = { preset_id: existing.preset_id, display_name: existing.display_name, is_enabled: enabled, email_domains: existing.email_domains, config: existing.config ?? {}, claim_mapping: existing.claim_mapping };
      return savedOf(await updateIdentityProvider(ctx, providerId, body));
    },
    { revalidate: REVALIDATE },
  );
}

/** Removes a provider. The wizard uses it to throw away the draft of a provider that was tested and never saved. */
export async function removeProvider(input: ProviderTarget): Promise<ActionResult<{ readonly removed: true }>> {
  return runAction(
    async (ctx) => {
      await deleteIdentityProvider(ctx, pickText(input, 'providerId') ?? '');
      return { removed: true } as const;
    },
    { revalidate: REVALIDATE },
  );
}

// ---------------------------------------------------------------------------------------------
// Group rules
// ---------------------------------------------------------------------------------------------

async function ruleOf(ctx: RequestContext, id: string) {
  const found = (await readFirstAsync(() => listRoleMappings(ctx, { limit: 200 }), () => updateRoleMapping(ctx, id, {}))).items.find((mapping) => mapping.id === id);
  if (found === undefined) throw new NotFoundError('Group rule not found.');
  return found;
}

function saved(mapping: { readonly id: string; readonly group_match: string }): RuleSaved {
  return { id: mapping.id, match: mapping.group_match };
}

/** Adds or changes a group rule. A change keeps the provider the rule is tied to and whether it is on. */
export async function saveRule(input: RuleInput): Promise<ActionResult<RuleSaved>> {
  return runAction(
    async (ctx) => {
      const ruleId = pickText(input, 'ruleId');
      const fields = pickFields(input, ['group_match', 'group_match_type', 'assigned_role', 'zone_ids', 'priority']);
      const body = { group_match: fields.group_match, group_match_type: fields.group_match_type, assigned_role: fields.assigned_role, zone_ids: fields.zone_ids, priority: fields.priority };
      if (ruleId === undefined) return saved(await createRoleMapping(ctx, body));
      const existing = await ruleOf(ctx, ruleId);
      return saved(await updateRoleMapping(ctx, ruleId, { ...body, identity_provider_id: existing.identity_provider_id ?? null, is_enabled: existing.is_enabled !== false }));
    },
    { revalidate: REVALIDATE },
  );
}

/** Turns a rule on or off (the switch in the table). */
export async function setRuleEnabled(input: RuleEnabledInput): Promise<ActionResult<RuleSaved>> {
  return runAction(
    async (ctx) => {
      const ruleId = pickText(input, 'ruleId') ?? '';
      const enabled = pickFields(input, ['enabled']).enabled;
      if (typeof enabled !== 'boolean') throw new InvalidInputError('Group rule: say whether it is on.');
      const existing = await ruleOf(ctx, ruleId);
      const body = { group_match: existing.group_match, group_match_type: existing.group_match_type, assigned_role: existing.assigned_role, zone_ids: existing.zone_ids, priority: existing.priority, identity_provider_id: existing.identity_provider_id ?? null, is_enabled: enabled };
      return saved(await updateRoleMapping(ctx, ruleId, body));
    },
    { revalidate: REVALIDATE },
  );
}

export async function removeRule(input: RuleTarget): Promise<ActionResult<{ readonly removed: true }>> {
  return runAction(
    async (ctx) => {
      await deleteRoleMapping(ctx, pickText(input, 'ruleId') ?? '');
      return { removed: true } as const;
    },
    { revalidate: REVALIDATE },
  );
}

/** What role and zones these groups would get. A read: nothing is written or audited, and no rule changes. */
export async function previewRules(input: PreviewInput): Promise<ActionResult<PreviewResult>> {
  return runAction(async (ctx) => {
    const groups = pickTextList(input, 'groups', MAX_GROUPS);
    if (groups === undefined) throw new InvalidInputError(`Preview: give at most ${MAX_GROUPS} group names.`);
    return previewGroups(ctx, groups, await zoneCodeMap(ctx));
  });
}

// ---------------------------------------------------------------------------------------------
// Sign-in policy and the emergency administrator
// ---------------------------------------------------------------------------------------------

/** Saves the sign-in policy and, when it changed, the session length. Both writes are audited, the sign-in policy first. */
export async function saveSignInPolicy(input: PolicyInput): Promise<ActionResult<PolicySaved>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['force_sso_email_domains', 'require_mfa_claim', 'session_length_minutes']);
      const current = await readFirstAsync(() => getSignInPolicy(ctx), () => updateSignInPolicy(ctx, {}));
      const policy = await updateSignInPolicy(ctx, {
        force_sso_email_domains: fields.force_sso_email_domains,
        require_mfa_claim: fields.require_mfa_claim,
        allow_local_users_for_outsiders: current.allow_local_users_for_outsiders,
        emergency_admin_enabled: current.emergency_admin_enabled,
      });
      const session = await readFirstAsync(() => getSessionPolicy(ctx), () => updateSessionPolicy(ctx, {}));
      const minutes = fields.session_length_minutes;
      const sessionMinutes = minutes === session.session_length_minutes ? session.session_length_minutes : (await updateSessionPolicy(ctx, { session_length_minutes: minutes, idle_timeout_minutes: session.idle_timeout_minutes, max_concurrent_sessions: session.max_concurrent_sessions })).session_length_minutes;
      return { forceDomains: [...policy.force_sso_email_domains], requireMfa: policy.require_mfa_claim, sessionMinutes } satisfies PolicySaved;
    },
    { revalidate: REVALIDATE },
  );
}

/** Switches emergency sign-in on or off: the rest of the sign-in policy is read and written back as it is. */
export async function setEmergencySignIn(input: EmergencyInput): Promise<ActionResult<{ readonly enabled: boolean }>> {
  return runAction(
    async (ctx) => {
      const enabled = pickFields(input, ['enabled']).enabled;
      if (typeof enabled !== 'boolean') throw new InvalidInputError('Emergency sign-in: say whether it is on.');
      const current = await readFirstAsync(() => getSignInPolicy(ctx), () => updateSignInPolicy(ctx, {}));
      const policy = await updateSignInPolicy(ctx, {
        force_sso_email_domains: current.force_sso_email_domains,
        require_mfa_claim: current.require_mfa_claim,
        allow_local_users_for_outsiders: current.allow_local_users_for_outsiders,
        emergency_admin_enabled: enabled,
      });
      return { enabled: policy.emergency_admin_enabled };
    },
    { revalidate: REVALIDATE },
  );
}

/** LABELLED STUB: asks for a change to the providers (shared installs). Audited and raises an in-app alert; nothing is sent. */
export async function requestChange(input: ChangeRequestInput): Promise<ActionResult<ChangeReceipt>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['providerId', 'change']);
      const body = { ...(typeof fields.providerId === 'string' ? { provider_id: fields.providerId } : {}), change: fields.change };
      return { referenceCode: (await requestIdentityProviderChange(ctx, body)).reference_code } satisfies ChangeReceipt;
    },
    { revalidate: REVALIDATE },
  );
}
