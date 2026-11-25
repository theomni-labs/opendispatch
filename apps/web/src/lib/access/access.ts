// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Access functions. Pure: no framework, no store, no I/O. The data layer (server side) and both
 * shells call these; neither should read the tables in matrix.ts directly.
 *
 * Every function fails closed on values that are not one of the known enums,
 * because a role or install mode read from a cookie is a string until proven otherwise.
 */

import { INSTALL_MODE_RULES, APPROVAL_MODULE, APPROVER_ROLES, ROLE_INSTALL_MODES, ROLE_MODULE_ACCESS, SCOPE_BY_ROLE } from './matrix';
import { GROUPS, MODULES } from './modules';
import type {
  ApprovalDecision,
  ApprovalKind,
  ApprovalRequest,
  Console,
  GroupId,
  InstallMode,
  ModuleAccessResult,
  ModuleDef,
  ModuleId,
  Role,
  ScopeKind,
  ZoneScope,
} from './types';
import { APPROVAL_KINDS, CONSOLES, ROLES, isApprovalKind, isInstallMode, isModuleId, isRole } from './types';

// ---------------------------------------------------------------------------------------------
// Roles and install modes
// ---------------------------------------------------------------------------------------------

function roleExistsIn(role: Role, installMode: InstallMode): boolean {
  return isRole(role) && isInstallMode(installMode) && ROLE_INSTALL_MODES[role].includes(installMode);
}

/**
 * The roles a demo switcher (and Users and Roles) offers in an install mode, in the role matrix order:
 * seven in private installs, six otherwise (Change Approver exists only in private installs).
 */
export function rolesForInstallMode(installMode: InstallMode): Role[] {
  return ROLES.filter((role) => roleExistsIn(role, installMode));
}

// ---------------------------------------------------------------------------------------------
// Module access
// ---------------------------------------------------------------------------------------------

/**
 * What a role may do in a module in an install mode.
 * - 'none': not in the menu. Also returned for unknown values and for a role that does not exist in
 *   this install mode.
 * - `reduced` is true only for the Administrator's Updates item in dedicated and shared installs.
 */
export function moduleAccess(role: Role, moduleId: ModuleId, installMode: InstallMode): ModuleAccessResult {
  if (!isModuleId(moduleId) || !roleExistsIn(role, installMode)) return { access: 'none', reduced: false };
  const rule = INSTALL_MODE_RULES.find((r) => r.moduleId === moduleId && r.role === role && r.modes.includes(installMode));
  if (rule !== undefined) return { access: rule.result.access, reduced: rule.result.reduced };
  return { access: ROLE_MODULE_ACCESS[moduleId][role], reduced: false };
}

/**
 * True when the role has at least one module in the console. Without `installMode` this reads the
 * private-install matrix (Change Approver sees Admin); with it, a role missing from that install
 * mode sees nothing. Roles with 'none' for a whole console get the no-access page there.
 */
export function canSeeConsole(role: Role, console: Console, installMode?: InstallMode): boolean {
  if (!isRole(role) || !CONSOLES.includes(console)) return false;
  return MODULES.some((m) => {
    if (m.console !== console) return false;
    const access = installMode === undefined ? ROLE_MODULE_ACCESS[m.id][role] : moduleAccess(role, m.id, installMode).access;
    return access !== 'none';
  });
}

// ---------------------------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------------------------

export interface MenuGroup {
  readonly group: GroupId;
  /** i18n message key of the group label. */
  readonly groupKey: string;
  readonly items: ModuleDef[];
}

export interface MenuConsole {
  readonly console: Console;
  readonly groups: MenuGroup[];
}

/**
 * The menu a role gets in an install mode: consoles in the order Ops, Admin; groups in the order of
 * GROUPS; items in plan number order. Only items whose access is not 'none' appear, and empty
 * groups and consoles are left out, so a role with nothing gets an empty array.
 * Use moduleAccess() for an item's edit or view level and its `reduced` flag.
 */
export function menuFor(role: Role, installMode: InstallMode): MenuConsole[] {
  const menu: MenuConsole[] = [];
  for (const consoleId of CONSOLES) {
    const groups: MenuGroup[] = [];
    for (const g of GROUPS) {
      if (g.console !== consoleId) continue;
      const items = MODULES.filter((m) => m.group === g.id && moduleAccess(role, m.id, installMode).access !== 'none');
      if (items.length > 0) groups.push({ group: g.id, groupKey: g.groupKey, items });
    }
    if (groups.length > 0) menu.push({ console: consoleId, groups });
  }
  return menu;
}

/**
 * Where a role lands after choosing it (plan silent, so this is an `assumption`, see README).
 * The first module, in menu order, where the role can do something: edit, or approve. If the role
 * can only read, the first module in the menu. Null when the menu is empty (Change Approver outside
 * private installs).
 *
 * Examples: Dispatcher lands on Ops Live Dispatch Board; Planner on Ops Field Planner; Administrator
 * on Admin Users and Roles (Ops is read-only for them); Change Approver on Admin Updates, not on
 * Audit Log, because Updates is where they approve.
 */
export function defaultLanding(role: Role, installMode: InstallMode): { console: Console; moduleId: ModuleId } | null {
  const items = menuFor(role, installMode).flatMap((c) => c.groups.flatMap((g) => g.items));
  const approves = approvalKindsFor(role, installMode).map((kind) => APPROVAL_MODULE[kind]);
  const acts = items.find((m) => moduleAccess(role, m.id, installMode).access === 'edit' || approves.includes(m.id));
  const target = acts ?? items[0];
  return target === undefined ? null : { console: target.console, moduleId: target.id };
}

// ---------------------------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------------------------

/** How far a role reaches, per the role matrix: the whole install, its assigned zones, or the remote pool. */
export function scopeAppliesTo(role: Role): ScopeKind {
  return SCOPE_BY_ROLE[role];
}

/**
 * Builds the ZoneScope for a person. Roles with "whole install" or "remote pool" scope ignore the
 * zone list; "assigned zones" roles get exactly the zones given (none given means no zone).
 */
export function zoneScopeFor(role: Role, assignedZoneIds: readonly string[] = []): ZoneScope {
  const kind = isRole(role) ? scopeAppliesTo(role) : 'assigned_zones';
  if (kind === 'whole_install') return { kind: 'whole_install' };
  if (kind === 'remote_pool') return { kind: 'remote_pool' };
  return { kind: 'assigned_zones', zoneIds: [...assignedZoneIds] };
}

/**
 * Whether a zone id is inside a scope.
 * - whole_install: every zone.
 * - assigned_zones: only the listed ids (exact match, so an empty list reaches nothing).
 * - remote_pool: no zone. assumption: the remote pool is not a zone the role matrix says "Remote
 *   pool", not a zone list), so a zone-bound record is out of reach; the data layer treats remote
 *   work by the pool, not by zone id.
 */
export function zoneAllowed(scope: ZoneScope, zoneId: string): boolean {
  switch (scope.kind) {
    case 'whole_install':
      return true;
    case 'assigned_zones':
      return scope.zoneIds.includes(zoneId);
    case 'remote_pool':
      return false;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------------------------

/**
 * Decides whether a person may approve a request, and why not. Order of checks: known values, role
 * exists in the install mode (if given), role may approve this kind, and nobody approves their own
 * request. Zone scope is a separate check (zoneAllowed) because a request carries no zone here.
 * The emergency override on Updates needs two approvers; that is two calls with two different people.
 */
export function checkApproval(request: ApprovalRequest): ApprovalDecision {
  const { role, kind, installMode, requesterUserId, approverUserId } = request;
  if (!isRole(role) || !isApprovalKind(kind)) return { allowed: false, reason: 'invalid_input' };
  if (installMode !== undefined) {
    if (!isInstallMode(installMode)) return { allowed: false, reason: 'invalid_input' };
    if (!roleExistsIn(role, installMode)) return { allowed: false, reason: 'role_not_in_install_mode' };
  }
  if (!APPROVER_ROLES[kind].includes(role)) return { allowed: false, reason: 'role_cannot_approve_kind' };
  if (typeof requesterUserId !== 'string' || typeof approverUserId !== 'string' || requesterUserId === '' || approverUserId === '') {
    return { allowed: false, reason: 'invalid_input' };
  }
  if (requesterUserId === approverUserId) return { allowed: false, reason: 'own_request' };
  return { allowed: true };
}

/** True when checkApproval() allows it. */
export function canApprove(request: ApprovalRequest): boolean {
  return checkApproval(request).allowed;
}

/**
 * The kinds of request a role may approve in an install mode (before the no-self-approval check).
 * The shell uses this to show or disable Approve and Reject.
 */
export function approvalKindsFor(role: Role, installMode: InstallMode): ApprovalKind[] {
  if (!roleExistsIn(role, installMode)) return [];
  return APPROVAL_KINDS.filter((kind) => APPROVER_ROLES[kind].includes(role));
}
