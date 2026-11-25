// SPDX-License-Identifier: AGPL-3.0-only
// What the screen knows about each preset that the data layer does not say in a translatable form.
// The data layer gives every preset field an English label and English notes; the screen shows the mockup's translated ones,
// looked up here by preset and field. Plain constants: server and client files may both import this.

import type { PresetId } from './types';

/** The message key (under `f.`) of the label of a preset's field: the same key can label a field of several presets. */
export const FIELD_LABEL: Readonly<Record<string, string>> = {
  'entra_id_oidc.directory_tenant_id': 'directory_tenant_id',
  'entra_id_oidc.client_id': 'app_client_id',
  'entra_id_oidc.client_secret': 'client_secret',
  'entra_id_saml.metadata_url': 'metadata_url',
  'entra_id_saml.entity_id': 'entity_id',
  'adfs_saml.metadata_url': 'fed_metadata_url',
  'adfs_saml.entity_id': 'entity_id',
  'adfs_oidc.issuer_url': 'adfs_issuer_url',
  'adfs_oidc.client_id': 'client_id',
  'adfs_oidc.client_secret': 'client_secret',
  'okta.okta_domain': 'okta_domain',
  'okta.client_id': 'client_id',
  'okta.client_secret': 'client_secret',
  'google_workspace.client_id': 'client_id',
  'google_workspace.client_secret': 'client_secret',
  'google_workspace.hosted_domain': 'hosted_domain',
  'ping_identity.issuer_url': 'issuer_url',
  'ping_identity.client_id': 'client_id',
  'ping_identity.client_secret': 'client_secret',
  'generic_oidc.issuer_url': 'issuer_url',
  'generic_oidc.client_id': 'client_id',
  'generic_oidc.client_secret': 'client_secret',
  'generic_oidc.scopes': 'scopes',
  'generic_saml.sso_url': 'sso_url',
  'generic_saml.entity_id': 'entity_id',
  'generic_saml.signing_certificate': 'signing_certificate',
  'generic_saml.name_id_format': 'name_id_format',
  'generic_saml.principal_type': 'principal_type',
};

/** Preset fields that are not one-line text: a certificate box, or a choice with its message keys. */
export const FIELD_INPUT: Readonly<Record<string, { readonly kind: 'textarea' } | { readonly kind: 'select'; readonly options: Readonly<Record<string, string>> }>> = {
  'generic_saml.signing_certificate': { kind: 'textarea' },
  'generic_saml.name_id_format': { kind: 'select', options: { persistent: 'nameid.persistent', email: 'nameid.email', transient: 'nameid.transient', unspecified: 'nameid.unspecified' } },
  'generic_saml.principal_type': { kind: 'select', options: { subject: 'principal.subject', email: 'principal.email' } },
};

/** The tone and message key of each Keycloak sync state. */
export const SYNC_PILL: Readonly<Record<'synced' | 'failed' | 'not_configured', { readonly tone: 'success' | 'danger' | 'neutral'; readonly key: string }>> = {
  synced: { tone: 'success', key: 'sync.synced' },
  failed: { tone: 'danger', key: 'sync.failed' },
  not_configured: { tone: 'neutral', key: 'sync.not_configured' },
};

/** The message keys (`entra.200`, `note.okta`, ...) of a preset's notes, in the order to show them. The Entra ones are warnings. */
export const PRESET_NOTES: Readonly<Record<PresetId, { readonly warning: readonly string[]; readonly hint: readonly string[] }>> = {
  entra_id_oidc: { warning: ['entra.200'], hint: [] },
  entra_id_saml: { warning: ['entra.150'], hint: [] },
  adfs_saml: { warning: [], hint: ['note.adfs_saml'] },
  adfs_oidc: { warning: [], hint: ['note.adfs_oidc'] },
  okta: { warning: [], hint: ['note.okta'] },
  google_workspace: { warning: [], hint: ['note.google_workspace'] },
  ping_identity: { warning: [], hint: ['note.ping_identity'] },
  generic_oidc: { warning: [], hint: [] },
  generic_saml: { warning: [], hint: ['note.generic_saml'] },
};

/** The steps of the scripted connection test: the data layer's `code` of each step and the message key that translates it (DG14). */
export const STEP_LABEL: Readonly<Record<string, string>> = {
  keycloak: 'step.keycloak',
  reach: 'step.reach',
  discovery: 'step.discovery',
  client: 'step.client',
  claims: 'step.claims',
  saml: 'step.saml',
  signed: 'step.signed',
  attrs: 'step.attrs',
};

/** The session lengths the mockup offers, in minutes. The stored value is added when it is none of these (the Security tab can set any). */
export const SESSION_CHOICES: readonly number[] = [240, 480, 720];

/** The message keys of the three sessions above. */
export const SESSION_LABEL: Readonly<Record<number, string>> = { 240: 'h.4', 480: 'h.8', 720: 'h.12' };

/** The protocols' names: proper names, the same in every language (translate="no"). */
export const PROTOCOL_NAME: Readonly<Record<'oidc' | 'saml', string>> = { oidc: 'OIDC', saml: 'SAML 2.0' };
