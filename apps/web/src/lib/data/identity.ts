// SPDX-License-Identifier: AGPL-3.0-only
// Sign-in, identity and sessions: Go client.

import type {
  ConnectionTestResult,
  IdentityProvider,
  IdentityProviderChangeReceipt,
  IdentityProviderList,
  IdentityProviderPresetList,
  IdentityProviderWrite,
  RoleMapping,
  RoleMappingList,
  RoleMappingPreview,
  SessionContext,
  SignInPolicy,
  SignInResult,
} from '@/lib/types';
import { requirePlatform, requirePreSession, v, type PageQuery } from './context';
import type { PreSessionContext, RequestContext } from './guard';
import { businessFetch, preSessionPost } from './internal/business-client';
import { NotFoundError } from './errors';
import { pathSegment } from './internal/path-segment';

export const MOCK_PROVIDER_ID = 'mock-provider';

/** @pure A provider alias is text, never a number. */
function providerSegment(id: unknown): string {
  return typeof id === 'string' ? pathSegment(id) : '-';
}

function qs(query: PageQuery): string {
  const parts = Object.entries({ limit: query.limit, cursor: query.cursor }).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}


// operationId: listIdentityProviderPresets
export async function listIdentityProviderPresets(ctx: RequestContext, query: PageQuery = {}): Promise<IdentityProviderPresetList> {
  return (await businessFetch<IdentityProviderPresetList>(ctx, `/identity-providers/presets${qs(query)}`))!;
}

// operationId: listIdentityProviders
export async function listIdentityProviders(ctx: RequestContext, query: PageQuery = {}): Promise<IdentityProviderList> {
  return (await businessFetch<IdentityProviderList>(ctx, `/identity-providers${qs(query)}`))!;
}

// operationId: getIdentityProvider
export async function getIdentityProvider(ctx: RequestContext, providerId: string): Promise<IdentityProvider> {
  const found = await businessFetch<IdentityProvider>(ctx, `/identity-providers/${providerSegment(providerId)}`);
  if (found === undefined) throw new NotFoundError('Identity provider not found.');
  return found;
}

// operationId: createIdentityProvider
export async function createIdentityProvider(ctx: RequestContext, body: IdentityProviderWrite | unknown): Promise<IdentityProvider> {
  return (await businessFetch<IdentityProvider>(ctx, '/identity-providers', { method: 'POST', body }))!;
}

// operationId: updateIdentityProvider
export async function updateIdentityProvider(ctx: RequestContext, providerId: string, body: unknown): Promise<IdentityProvider> {
  return (await businessFetch<IdentityProvider>(ctx, `/identity-providers/${providerSegment(providerId)}`, { method: 'PUT', body }))!;
}

// operationId: deleteIdentityProvider
export async function deleteIdentityProvider(ctx: RequestContext, providerId: string): Promise<void> {
  await businessFetch<undefined>(ctx, `/identity-providers/${providerSegment(providerId)}`, { method: 'DELETE' });
}

/** "Request a change" (DG5): needs only view of the module; Go audits it and raises the alert. */
// operationId: requestIdentityProviderChange
export async function requestIdentityProviderChange(ctx: RequestContext, body: unknown): Promise<IdentityProviderChangeReceipt> {
  return (await businessFetch<IdentityProviderChangeReceipt>(ctx, '/identity-providers/change-requests', { method: 'POST', body }))!;
}

/** Scripted test: no network call. */
// operationId: testIdentityProviderConnection
export async function testIdentityProviderConnection(ctx: RequestContext, providerId: string): Promise<ConnectionTestResult> {
  return (await businessFetch<ConnectionTestResult>(ctx, `/identity-providers/${providerSegment(providerId)}/test`, { method: 'POST' }))!;
}

// operationId: listRoleMappings
export async function listRoleMappings(ctx: RequestContext, query: PageQuery = {}): Promise<RoleMappingList> {
  return (await businessFetch<RoleMappingList>(ctx, `/role-mappings${qs(query)}`))!;
}

// operationId: createRoleMapping
export async function createRoleMapping(ctx: RequestContext, body: unknown): Promise<RoleMapping> {
  return (await businessFetch<RoleMapping>(ctx, '/role-mappings', { method: 'POST', body }))!;
}

// operationId: updateRoleMapping
export async function updateRoleMapping(ctx: RequestContext, id: string, body: unknown): Promise<RoleMapping> {
  return (await businessFetch<RoleMapping>(ctx, `/role-mappings/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: deleteRoleMapping
export async function deleteRoleMapping(ctx: RequestContext, id: string): Promise<void> {
  await businessFetch<undefined>(ctx, `/role-mappings/${pathSegment(id)}`, { method: 'DELETE' });
}

/** Read only despite POST. */
// operationId: previewRoleMappings
export async function previewRoleMappings(ctx: RequestContext, body: unknown): Promise<RoleMappingPreview> {
  return (await businessFetch<RoleMappingPreview>(ctx, '/role-mappings/preview', { method: 'POST', body }))!;
}

// operationId: getSignInPolicy
export async function getSignInPolicy(ctx: RequestContext): Promise<SignInPolicy> {
  return (await businessFetch<SignInPolicy>(ctx, '/sign-in-policy'))!;
}

// operationId: updateSignInPolicy
export async function updateSignInPolicy(ctx: RequestContext, body: unknown): Promise<SignInPolicy> {
  return (await businessFetch<SignInPolicy>(ctx, '/sign-in-policy', { method: 'PUT', body }))!;
}

/**
 * Demo only. Runs before anyone has signed in: it takes the PreSessionContext (customer and install mode, no role,
 * no user), never a RequestContext. Go audits it with no actor.
 */
// operationId: mockSignIn
export async function mockSignIn(pre: PreSessionContext, body: unknown): Promise<SignInResult> {
  requirePreSession(pre);
  const input = v.object(body, 'Mock sign-in', ['provider_id', 'subject', 'groups']);
  return preSessionPost<SignInResult>(pre, '/auth/mock-sign-in', input);
}

/**
 * Local emergency administrator sign-in. Like mockSignIn it runs before anyone
 * has signed in and takes the PreSessionContext. Go compares the credentials, counts failures and audits every attempt.
 */
// operationId: emergencyAdminSignIn
export async function emergencyAdminSignIn(pre: PreSessionContext, body: unknown): Promise<SignInResult> {
  requirePreSession(pre);
  const input = v.object(body, 'Emergency sign-in', ['email', 'password', 'totp_code']);
  return preSessionPost<SignInResult>(pre, '/auth/emergency-admin/sign-in', input);
}

// operationId: getSessionContext
export async function getSessionContext(ctx: RequestContext): Promise<SessionContext> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<SessionContext>(ctx, '/me'))!;
}

/** Records the sign-out. The shell's action clears the session cookie; Go audits it. */
// operationId: signOut
export async function signOut(ctx: RequestContext): Promise<void> {
  requirePlatform(ctx, 'platform.session');
  await businessFetch<undefined>(ctx, '/auth/sign-out', { method: 'POST' });
}
