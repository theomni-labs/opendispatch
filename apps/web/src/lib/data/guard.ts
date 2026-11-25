// SPDX-License-Identifier: AGPL-3.0-only
// Access helpers for screens; Go enforces.

import { moduleAccess, zoneAllowed, type Access, type InstallMode, type ModuleId, type Role, type ZoneScope } from '@/lib/access';
import { ForbiddenError } from './errors';

/**
 * Who is asking. Built on the server from the session cookie (demo mode) or the Keycloak token
 * (oidc mode), never from anything the browser sends.
 */
export interface RequestContext {
  readonly customerId: string;
  readonly userId: string;
  readonly role: Role;
  readonly zoneScope: ZoneScope;
  readonly installMode: InstallMode;
}

/**
 * Who is asking before anyone has signed in (. Built on the server by
 * getPreSessionContext(): the customer is the fixture tenant (oidc mode: the host and realm) and the install mode comes
 * from the signed `opendispatch_demo_mode` cookie (oidc mode: the install's configuration). It has no role, no user and no zone
 * scope, and it cannot get one: a signed-out visitor has no default role, so this type is not a RequestContext
 * and a RequestContext is not this type (the three `never` fields make the assignment a compile error both ways).
 *
 * Exactly two operations accept it: mockSignIn and emergencyAdminSignIn. Every other operation takes a RequestContext.
 */
export interface PreSessionContext {
  readonly customerId: string;
  readonly installMode: InstallMode;
  readonly role?: never;
  readonly userId?: never;
  readonly zoneScope?: never;
}

const RANK: Readonly<Record<Access, number>> = { none: 0, view: 1, edit: 2 };

/** @pure The role's access to a module in the caller's install mode. Reads nothing from the store. */
export function accessTo(ctx: RequestContext, moduleId: ModuleId): Access {
  return moduleAccess(ctx.role, moduleId, ctx.installMode).access;
}

/** @pure */
export function canAccess(ctx: RequestContext, moduleId: ModuleId, needed: Exclude<Access, 'none'>): boolean {
  return RANK[accessTo(ctx, moduleId)] >= RANK[needed];
}

/** Throws ForbiddenError unless the role may view (or edit) the module in this install mode. */
export function requireAccess(ctx: RequestContext, moduleId: ModuleId, needed: Exclude<Access, 'none'>): void {
  if (!canAccess(ctx, moduleId, needed)) {
    throw new ForbiddenError(`${ctx.role} may not ${needed} ${moduleId} in a ${ctx.installMode} install.`);
  }
}

/**
 * Read scope for records that belong to a zone.
 * - whole install: every zone.
 * - assigned zones: the listed zones only.
 * - remote pool: assumption: the pool is not a zone, but the Remote Team Lead's read-only views
 *   (Forecast Explorer, Gap and Surplus, Management Dashboards) span zones, so every zone is readable.
 *   Writes are checked separately by canWriteZone.
 * A record with no zone is readable only by roles that are not limited to assigned zones.
 *
 * @pure
 */
export function canReadZone(ctx: RequestContext, zoneId: string | null | undefined): boolean {
  const scope = ctx.zoneScope;
  if (scope.kind !== 'assigned_zones') return true;
  return zoneId !== null && zoneId !== undefined && zoneAllowed(scope, zoneId);
}

/** @pure Write scope: whole install, or a listed zone. The remote pool writes only through pool-specific functions. */
export function canWriteZone(ctx: RequestContext, zoneId: string | null | undefined): boolean {
  if (ctx.zoneScope.kind === 'whole_install') return true;
  return zoneId !== null && zoneId !== undefined && zoneAllowed(ctx.zoneScope, zoneId);
}
