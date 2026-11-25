// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Sign-in and Identity screen: what the server side hands to the client files.
// Everything here is JSON-safe. Nothing here is a context, a customer or the caller's role.

import type { Role, ScopeKind } from '@/lib/access';
import type { AuditTimelineEvent } from '@/components/opendispatch/patterns/AuditTimeline';
import type { PickerZone } from '@/components/opendispatch/patterns/ZonePicker';
import type { DataSource } from '@/lib/types';

export const TABS = ['providers', 'rules', 'policy', 'emergency'] as const;
export type Tab = (typeof TABS)[number];

export type Protocol = 'oidc' | 'saml';
export type PresetId = 'entra_id_oidc' | 'entra_id_saml' | 'adfs_saml' | 'adfs_oidc' | 'okta' | 'google_workspace' | 'ping_identity' | 'generic_oidc' | 'generic_saml';
export type MatchType = 'exact' | 'object_id' | 'prefix';

export interface Claims {
  readonly email: string;
  readonly name: string;
  readonly groups: string;
}

/** A provider as the table needs it. */
export interface ProviderRow {
  readonly id: string;
  readonly name: string;
  readonly presetId: string;
  readonly presetName: string;
  readonly protocol: Protocol;
  readonly domains: readonly string[];
  readonly enabled: boolean;
  /** The labelled mock provider of the demo: always present, cannot be changed or removed. */
  readonly mock: boolean;
  /** True in the shared tier (our staff manage providers): the person only reads it. */
  readonly readOnly: boolean;
  /** The last scripted connection test: passed or failed, and when (ISO). Null when it was never tested. */
  readonly lastTest: { readonly ok: boolean; readonly at: string | null } | null;
  /** Keycloak sync: synced, failed (with the reason) or stored only. Null for the mock provider. */
  readonly sync: SyncView | null;
}

export type SyncStatus = 'synced' | 'failed' | 'not_configured';

export interface SyncView {
  readonly status: SyncStatus;
  readonly at: string | null;
  readonly error: string | null;
}

/** A provider with what its drawer and the edit wizard need. Never a secret: only whether one was given. */
export interface ProviderDetail extends ProviderRow {
  readonly config: Readonly<Record<string, string>>;
  readonly claims: Claims;
  readonly hasSecret: boolean;
}

export interface PresetField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly placeholder: string | null;
}

export interface PresetView {
  readonly id: PresetId;
  readonly name: string;
  readonly protocol: Protocol;
  readonly fields: readonly PresetField[];
  readonly claims: Claims;
}

export interface RoleOption {
  readonly role: Role;
  readonly scope: ScopeKind;
  /** False when the role does not exist in this install mode (Change Approver outside private installs). */
  readonly availableHere: boolean;
}

/** One group rule as the table and the editor need it. */
export interface RuleRow {
  readonly id: string;
  readonly priority: number;
  readonly match: string;
  readonly matchType: MatchType;
  readonly role: Role;
  readonly scope: ScopeKind;
  readonly zoneIds: readonly string[];
  readonly zoneCodes: readonly string[];
  readonly enabled: boolean;
  /** False when the rule's role does not exist in this install mode: the rule never applies here. */
  readonly live: boolean;
}

/** What the group preview says: the role (or none: no access), the zones, and which rules matched. */
export interface PreviewResult {
  readonly role: Role | null;
  readonly zoneCodes: readonly string[];
  readonly matchedIds: readonly string[];
}

export interface PolicyView {
  /** The email domains that must use SSO. Empty: SSO is not forced. */
  readonly forceDomains: readonly string[];
  readonly requireMfa: boolean;
  /** The session length in minutes (the Security module's session policy). */
  readonly sessionMinutes: number;
  readonly emergencyEnabled: boolean;
}

export interface EmergencyView {
  readonly name: string | null;
  readonly email: string | null;
  /** ISO 8601, or null when the account has never signed in. */
  readonly lastSignIn: string | null;
  readonly events: readonly AuditTimelineEvent[];
  readonly names: Readonly<Record<string, string>>;
  /** The events' own data_source, for the screen's badge. */
  readonly sources: readonly DataSource[];
}

export type { PickerZone };

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types: no field
// here is a context, customer, user, role, zone scope or install mode. The role a rule gives is `assigned_role`.
// ---------------------------------------------------------------------------------------------

export interface ProviderInput {
  /** Set to change a provider; absent to add one. */
  readonly providerId?: string | undefined;
  readonly preset_id: string;
  readonly display_name: string;
  readonly email_domains: readonly string[];
  /** The non-secret settings of the preset, by key. */
  readonly config: Readonly<Record<string, string>>;
  /** Typed into the form; the data layer accepts it and discards it. */
  readonly client_secret?: string | undefined;
  readonly claim_mapping: Claims;
}

export interface ProviderTarget {
  readonly providerId: string;
}

export interface ProviderEnabledInput {
  readonly providerId: string;
  readonly enabled: boolean;
}

export interface RuleInput {
  /** Set to change a rule; absent to add one. */
  readonly ruleId?: string | undefined;
  readonly group_match: string;
  readonly group_match_type: string;
  readonly assigned_role: string;
  readonly zone_ids: readonly string[];
  readonly priority: number;
}

export interface RuleTarget {
  readonly ruleId: string;
}

export interface RuleEnabledInput {
  readonly ruleId: string;
  readonly enabled: boolean;
}

export interface PreviewInput {
  readonly groups: readonly string[];
}

export interface PolicyInput {
  readonly force_sso_email_domains: readonly string[];
  readonly require_mfa_claim: boolean;
  readonly session_length_minutes: number;
}

export interface EmergencyInput {
  readonly enabled: boolean;
}

export interface ChangeRequestInput {
  readonly providerId?: string | undefined;
  readonly change: string;
}

// What the actions give back: enough for a toast and the next render, nothing private.
export interface ProviderSaved {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

export interface TestStep {
  readonly code: string | null;
  readonly name: string;
  readonly ok: boolean;
  readonly message: string | null;
}

export interface TestOutcome {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly referenceCode: string | null;
  readonly steps: readonly TestStep[];
}

export interface ProviderTested {
  readonly provider: ProviderSaved;
  readonly test: TestOutcome;
}

export interface RuleSaved {
  readonly id: string;
  readonly match: string;
}

export interface PolicySaved {
  readonly forceDomains: readonly string[];
  readonly requireMfa: boolean;
  readonly sessionMinutes: number;
}

export interface ChangeReceipt {
  readonly referenceCode: string;
}
