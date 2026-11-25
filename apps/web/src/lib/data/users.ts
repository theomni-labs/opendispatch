// SPDX-License-Identifier: AGPL-3.0-only
// Users and roles: thin Go client.

import type { InstallMode, Role as RoleId, ScopeKind } from '@/lib/access';
import type { EffectiveAccess, EmergencyAdminResetResult, ModuleAccess, RoleList, User, UserDisplayNames, UserList } from '@/lib/types';
import { InvalidInputError, NotFoundError } from './errors';
import { requirePlatform, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { requireId } from './internal/ids';
import { pathSegment } from './internal/path-segment';


function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

function found<T>(value: T | undefined): T {
  if (value === undefined) throw new NotFoundError('User not found.');
  return value;
}

// operationId: listRoles
export async function listRoles(ctx: RequestContext, query: PageQuery = {}): Promise<RoleList> {
  return (await businessFetch<RoleList>(ctx, `/roles${qs({ limit: query.limit, cursor: query.cursor })}`))!;
}

// operationId: listUsers
export async function listUsers(
  ctx: RequestContext,
  query: PageQuery & { readonly q?: string | undefined; readonly status?: User['status'] | undefined; readonly assigned_role?: RoleId | undefined } = {},
): Promise<UserList> {
  return (await businessFetch<UserList>(ctx, `/users${qs({ limit: query.limit, cursor: query.cursor, q: query.q, status: query.status, assigned_role: query.assigned_role })}`))!;
}

// operationId: getUser
export async function getUser(ctx: RequestContext, id: string): Promise<User> {
  return found(await businessFetch<User>(ctx, `/users/${pathSegment(id)}`));
}

/** The most ids one call may ask for (DG1). */
const MAX_DISPLAY_NAME_IDS = 100;

/** Names only, never an e-mail, role or zone; open to every role. Ids that match no user are left out. */
// operationId: listUserDisplayNames
export async function listUserDisplayNames(ctx: RequestContext, ids: readonly string[]): Promise<UserDisplayNames> {
  requirePlatform(ctx, 'platform.session');
  if (!Array.isArray(ids)) throw new InvalidInputError('User ids: expected a list of ids.');
  if (ids.length < 1 || ids.length > MAX_DISPLAY_NAME_IDS) throw new InvalidInputError(`User ids: ask for 1 to ${MAX_DISPLAY_NAME_IDS} ids at a time.`);
  const wanted = [...new Set(ids.map((id) => requireId(id, 'User')))];
  return (await businessFetch<UserDisplayNames>(ctx, `/users/display-names${qs({ ids: wanted.join(',') })}`))!;
}

export interface AccessPreview {
  readonly assigned_role: RoleId;
  readonly install_mode: InstallMode;
  readonly scope: ScopeKind;
  readonly zone_ids: readonly string[];
  readonly modules: ModuleAccess[];
}

// operationId: getEffectiveAccess
export async function getEffectiveAccess(ctx: RequestContext, targetUserId: string): Promise<EffectiveAccess> {
  return found(await businessFetch<EffectiveAccess>(ctx, `/users/${pathSegment(targetUserId)}/effective-access`));
}

/** The same preview for a role that has not been saved yet (the Add user form). */
// operationId: (not in the contract) previewEffectiveAccess
export async function previewEffectiveAccess(ctx: RequestContext, body: unknown): Promise<AccessPreview> {
  return (await businessFetch<AccessPreview>(ctx, '/users/effective-access/preview', { method: 'POST', body }))!;
}

// operationId: createUser
export async function createUser(ctx: RequestContext, body: unknown): Promise<User> {
  return (await businessFetch<User>(ctx, '/users', { method: 'POST', body }))!;
}

// operationId: updateUser
export async function updateUser(ctx: RequestContext, id: string, body: unknown): Promise<User> {
  return (await businessFetch<User>(ctx, `/users/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: disableUser
export async function disableUser(ctx: RequestContext, id: string): Promise<User> {
  return (await businessFetch<User>(ctx, `/users/${pathSegment(id)}/disable`, { method: 'POST' }))!;
}

// operationId: enableUser
export async function enableUser(ctx: RequestContext, id: string): Promise<User> {
  return (await businessFetch<User>(ctx, `/users/${pathSegment(id)}/enable`, { method: 'POST' }))!;
}

/** LABELLED STUB: nothing changes; Keycloak would hold the temporary secret. Go audits it with `stub: true`. */
async function resetEmergencyAdmin(ctx: RequestContext, id: string, kind: 'password' | 'mfa'): Promise<EmergencyAdminResetResult> {
  return (await businessFetch<EmergencyAdminResetResult>(ctx, `/users/${pathSegment(id)}/emergency-admin/reset-${kind === 'password' ? 'password' : 'mfa'}`, { method: 'POST' }))!;
}

// operationId: resetEmergencyAdminPassword
export async function resetEmergencyAdminPassword(ctx: RequestContext, id: string): Promise<EmergencyAdminResetResult> {
  return resetEmergencyAdmin(ctx, id, 'password');
}

// operationId: resetEmergencyAdminMfa
export async function resetEmergencyAdminMfa(ctx: RequestContext, id: string): Promise<EmergencyAdminResetResult> {
  return resetEmergencyAdmin(ctx, id, 'mfa');
}

