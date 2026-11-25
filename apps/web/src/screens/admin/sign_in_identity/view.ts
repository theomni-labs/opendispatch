// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Sign-in and Identity screen: reads through lib/data with the request context and returns plain data
//. Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads: listIdentityProviderPresets, listIdentityProviders, listRoleMappings, previewRoleMappings (the first preview, so the
// page paints with a result), getSignInPolicy and getSessionPolicy (the policy tab: session length lives in the Security
// module), listUsers (the emergency account), listAuditEvents (its recent use), listZones and listCities (names for zones).

import { actorNames } from '@/components/opendispatch/patterns/audit-actors';
import type { AuditTimelineEvent } from '@/components/opendispatch/patterns/AuditTimeline';
import { ROLES, rolesForInstallMode, scopeAppliesTo, type InstallMode, type Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import type { RequestContext } from '@/lib/data/guard';
import { MOCK_PROVIDER_ID, listIdentityProviderPresets, listIdentityProviders, listRoleMappings, getSignInPolicy, previewRoleMappings } from '@/lib/data/identity';
import { listCities, listZones } from '@/lib/data/locations';
import { getSessionPolicy } from '@/lib/data/system';
import { listUsers } from '@/lib/data/users';
import type { City, DataSource, IdentityProvider, IdentityProviderPreset, PageInfo, RoleMapping, Zone } from '@/lib/types';
import type { EmergencyView, PickerZone, PolicyView, PresetView, PreviewResult, ProviderDetail, ProviderRow, RoleOption, RuleRow, Tab } from './types';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface IdentityQuery {
  readonly tab?: Tab | undefined;
  /** A provider id: opens its drawer. */
  readonly provider?: string | undefined;
  /** A rule id, or `new`: opens the rule editor. */
  readonly rule?: string | undefined;
  /** `1` adds a provider; a provider id changes that provider. */
  readonly wizard?: string | undefined;
}

export type WizardTarget = { readonly mode: 'new' } | { readonly mode: 'edit'; readonly provider: ProviderDetail };

export interface IdentityView {
  readonly installMode: InstallMode;
  readonly sources: readonly DataSource[];
  /** False when Keycloak admin access is not configured: providers are stored only. */
  readonly keycloakConnected: boolean;
  readonly providers: readonly ProviderRow[];
  readonly presets: readonly PresetView[];
  readonly rules: readonly RuleRow[];
  readonly zones: readonly PickerZone[];
  readonly roleOptions: readonly RoleOption[];
  readonly policy: PolicyView;
  /** The provider `?provider=` opens. */
  readonly openProvider: ProviderDetail | undefined;
  /** The rule `?rule=` opens: a rule, or `new`. */
  readonly openRule: RuleRow | 'new' | undefined;
  /** The wizard `?wizard=` opens. */
  readonly wizard: WizardTarget | undefined;
  /** `?provider=`, `?rule=` or `?wizard=` named something that does not exist (the screen says so above the tabs). */
  readonly unknown: { readonly provider: boolean; readonly rule: boolean; readonly wizard: boolean };
  /** Group names to try in the preview, taken from the rules, and the one the preview starts with. */
  readonly samples: readonly string[];
  readonly initialGroups: string;
  readonly initialPreview: PreviewResult;
  /** Only when the Emergency tab is open. */
  readonly emergency: EmergencyView | undefined;
  /** The settings of every tab as a JSON file, for "Export settings" (no secret is ever in it). */
  readonly exportJson: string;
}

const PAGE = 200;

async function listAll<T>(fetch: (cursor: string | undefined) => { items: T[]; page: PageInfo } | Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

/** The short code of a zone (`RD-C`), which the fixtures keep in `extra.code`; the name when a zone has none. */
export function zoneCode(zone: Zone): string {
  const code = zone.extra?.['code'];
  return typeof code === 'string' && code !== '' ? code : zone.name_en;
}

function presetView(preset: IdentityProviderPreset): PresetView {
  return {
    id: preset.id,
    name: preset.name_en,
    protocol: preset.protocol,
    fields: preset.fields.map((field) => ({ key: field.key, required: field.required, secret: field.secret, placeholder: field.placeholder ?? null })),
    claims: { ...preset.default_claims },
  };
}

export function providerRow(provider: IdentityProvider, presetName: string): ProviderRow {
  return {
    id: provider.id,
    name: provider.display_name,
    presetId: provider.preset_id,
    presetName,
    protocol: provider.protocol,
    domains: [...provider.email_domains],
    enabled: provider.is_enabled,
    mock: provider.id === MOCK_PROVIDER_ID,
    readOnly: provider.read_only === true,
    lastTest: provider.last_test_ok === undefined || provider.last_test_ok === null ? null : { ok: provider.last_test_ok, at: provider.last_test_at ?? null },
    sync: provider.sync_status === undefined ? null : { status: provider.sync_status, at: provider.last_sync_at ?? null, error: provider.last_sync_error ?? null },
  };
}

function providerDetail(provider: IdentityProvider, presetName: string): ProviderDetail {
  return { ...providerRow(provider, presetName), config: { ...(provider.config ?? {}) }, claims: { ...provider.claim_mapping }, hasSecret: provider.has_secret };
}

function ruleRow(mapping: RoleMapping, codeById: ReadonlyMap<string, string>, installMode: InstallMode): RuleRow {
  return {
    id: mapping.id,
    priority: mapping.priority,
    match: mapping.group_match,
    matchType: mapping.group_match_type,
    role: mapping.assigned_role,
    scope: scopeAppliesTo(mapping.assigned_role),
    zoneIds: [...mapping.zone_ids],
    zoneCodes: mapping.zone_ids.flatMap((id) => (codeById.has(id) ? [codeById.get(id) as string] : [])),
    enabled: mapping.is_enabled !== false,
    live: rolesForInstallMode(installMode).includes(mapping.assigned_role),
  };
}

/** Zone ids to their short codes, for the preview. */
export async function zoneCodeMap(ctx: RequestContext): Promise<Map<string, string>> {
  const zoneList = await listAll((cursor) => listZones(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  return new Map<string, string>(zoneList.map((zone) => [zone.id, zoneCode(zone)]));
}

/** The role and zones a list of groups gets, with zones as short codes. Read only. */
export async function previewGroups(ctx: RequestContext, groups: readonly string[], codeById: ReadonlyMap<string, string>): Promise<PreviewResult> {
  const result = await previewRoleMappings(ctx, { groups: [...groups] });
  return {
    role: result.assigned_role,
    zoneCodes: result.zone_ids.flatMap((id) => (codeById.has(id) ? [codeById.get(id) as string] : [])),
    matchedIds: [...result.matched_mapping_ids],
  };
}

const SAMPLE_COUNT = 3;
const UNKNOWN_GROUP = 'unknown-group';

async function emergencyOf(ctx: RequestContext): Promise<EmergencyView> {
  const account = (await listAll((cursor) => listUsers(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }))).find((user) => user.is_emergency_admin);
  // `auth.emergency` covers the seeded `auth.emergency_sign_in` and the `auth.emergency_admin_sign_in` the sign-in page writes.
  const events = (await listAuditEvents(ctx, { action_prefix: 'auth.emergency', limit: 5 })).items;
  const timeline: AuditTimelineEvent[] = events.map((event) => ({
    id: event.id,
    action: event.action,
    summary_en: event.summary_en,
    occurred_at: event.occurred_at,
    outcome: event.outcome,
    actor_type: event.actor_type,
    actor_user_id: event.actor_user_id ?? null,
  }));
  return { name: account?.display_name ?? null, email: account?.email ?? null, lastSignIn: account?.last_sign_in_at ?? null, events: timeline, names: await actorNames(ctx, events), sources: [...new Set(events.map((event) => event.data_source))] };
}

export async function loadIdentityView(ctx: RequestContext, query: IdentityQuery): Promise<IdentityView> {
  const presets = (await listAll((cursor) => listIdentityProviderPresets(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }))).map(presetView);
  const presetName = new Map(presets.map((preset) => [preset.id as string, preset.name]));
  let keycloakConnected = true;
  const providerList = await listAll(async (cursor) => {
    const page = await listIdentityProviders(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) });
    keycloakConnected = page.keycloak_connected !== false;
    return page;
  });
  const mappings = await listAll((cursor) => listRoleMappings(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const zoneList = await listAll((cursor) => listZones(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const cityList = await listAll((cursor) => listCities(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));

  const cityName = new Map<string, string>(cityList.map((city: City) => [city.id, city.name_en]));
  const codeById = new Map<string, string>(zoneList.map((zone) => [zone.id, zoneCode(zone)]));
  const zones: PickerZone[] = zoneList.map((zone) => ({ id: zone.id, code: zoneCode(zone), name: zone.name_en, cityId: zone.city_id, cityName: cityName.get(zone.city_id) ?? '' }));

  const providers = providerList.map((provider) => providerRow(provider, presetName.get(provider.preset_id) ?? provider.preset_id));
  const rules = mappings.map((mapping) => ruleRow(mapping, codeById, ctx.installMode));
  const roleOptions: RoleOption[] = ROLES.map((role: Role) => ({ role, scope: scopeAppliesTo(role), availableHere: rolesForInstallMode(ctx.installMode).includes(role) }));

  const sign = await getSignInPolicy(ctx);
  const session = await getSessionPolicy(ctx);
  const policy: PolicyView = { forceDomains: [...sign.force_sso_email_domains], requireMfa: sign.require_mfa_claim, sessionMinutes: session.session_length_minutes, emergencyEnabled: sign.emergency_admin_enabled };

  const detailOf = (id: string): ProviderDetail | undefined => {
    const provider = providerList.find((candidate) => candidate.id === id);
    return provider === undefined ? undefined : providerDetail(provider, presetName.get(provider.preset_id) ?? provider.preset_id);
  };
  const openProvider = query.provider === undefined ? undefined : detailOf(query.provider);
  const openRule: RuleRow | 'new' | undefined = query.rule === undefined ? undefined : query.rule === 'new' ? 'new' : rules.find((rule) => rule.id === query.rule);
  const wizardProvider = query.wizard === undefined || query.wizard === '1' ? undefined : detailOf(query.wizard);
  const wizard: WizardTarget | undefined = query.wizard === '1' ? { mode: 'new' } : wizardProvider === undefined ? undefined : wizardProvider.mock || wizardProvider.readOnly ? undefined : { mode: 'edit', provider: wizardProvider };

  const samples = [...new Set(rules.slice(0, SAMPLE_COUNT).map((rule) => rule.match))];
  if (!samples.includes(UNKNOWN_GROUP)) samples.push(UNKNOWN_GROUP);
  const initialGroups = rules.find((rule) => rule.role === 'dispatcher')?.match ?? rules[0]?.match ?? '';
  const initialPreview = await previewGroups(ctx, initialGroups === '' ? [] : [initialGroups], codeById);

  const emergency = query.tab === 'emergency' ? await emergencyOf(ctx) : undefined;

  const exportJson = JSON.stringify(
    {
      providers: providerList.map((provider) => ({ display_name: provider.display_name, preset_id: provider.preset_id, protocol: provider.protocol, is_enabled: provider.is_enabled, email_domains: provider.email_domains, config: provider.config ?? {}, claim_mapping: provider.claim_mapping })),
      group_rules: rules.map((rule) => ({ priority: rule.priority, group_match: rule.match, group_match_type: rule.matchType, assigned_role: rule.role, zones: rule.zoneCodes, is_enabled: rule.enabled })),
      sign_in_policy: { force_sso_email_domains: policy.forceDomains, require_mfa_claim: policy.requireMfa, session_length_minutes: policy.sessionMinutes, emergency_admin_enabled: policy.emergencyEnabled },
    },
    null,
    2,
  );

  return {
    installMode: ctx.installMode,
    keycloakConnected,
    sources: [...new Set([...providerList.map((provider) => provider.data_source), ...mappings.map((mapping) => mapping.data_source), ...(emergency?.sources ?? [])])],
    providers,
    presets,
    rules,
    zones,
    roleOptions,
    policy,
    openProvider,
    openRule,
    wizard,
    unknown: {
      provider: query.provider !== undefined && openProvider === undefined,
      rule: query.rule !== undefined && openRule === undefined,
      wizard: query.wizard !== undefined && wizard === undefined,
    },
    samples,
    initialGroups,
    initialPreview,
    emergency,
    exportJson,
  };
}
