// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Access model: shared types and the closed lists they come from.
 *
 * PURE TypeScript. This folder must never import next, react, fixtures, the demo store, the api
 * client or the data layer, because the data layer and both shells import it. Relative imports only.
 *
 * Source of truth: the product specification section 6.1 (Ops modules), section 6.2 (Admin modules),
 * the role matrix (roles, scopes and the role / console / module matrix), section 7 (sign-in),
 * and docs/decisions 5 and 6 plus the "Defaults taken" list.
 */

// ---------------------------------------------------------------------------------------------
// Roles, consoles, access levels, install modes
// ---------------------------------------------------------------------------------------------

/** The seven roles of the role matrix, in their documented order. */
export const ROLES = [
  'administrator',
  'dispatch_supervisor',
  'dispatcher',
  'planner',
  'remote_team_lead',
  'viewer_auditor',
  'change_approver',
] as const;
export type Role = (typeof ROLES)[number];

/** The two consoles built in this repository. The Operator Console lives in the host platform. */
export const CONSOLES = ['ops', 'admin'] as const;
export type Console = (typeof CONSOLES)[number];

/**
 * What a role may do inside a module it can see.
 * 'none' means the module is not in the role's menu at all. 'view' is read-only.
 * 'edit' may change things (in the role's own zones where the scope is "assigned zones").
 * Approving or rejecting is NOT an Access level: see ApprovalKind and approvalKindsFor().
 */
export const ACCESS_LEVELS = ['none', 'view', 'edit'] as const;
export type Access = (typeof ACCESS_LEVELS)[number];

/** Plan section 8.1. Only 'private' has the full Updates screen and the Change Approver role. */
export const INSTALL_MODES = ['private', 'dedicated', 'shared'] as const;
export type InstallMode = (typeof INSTALL_MODES)[number];

// ---------------------------------------------------------------------------------------------
// Zone scope
// ---------------------------------------------------------------------------------------------

/** How a role's reach is described in the role matrix. Same names in ZoneScope.kind. */
export type ScopeKind = 'whole_install' | 'assigned_zones' | 'remote_pool';

/**
 * A concrete scope for one signed-in person (this is what goes into the request context).
 * - whole_install: every zone.
 * - assigned_zones: exactly the listed zone ids (an empty list reaches nothing).
 * - remote_pool: the remote pool. A pool is not a zone, so it reaches no zone id (see zoneAllowed).
 */
export type ZoneScope =
  | { readonly kind: 'whole_install' }
  | { readonly kind: 'assigned_zones'; readonly zoneIds: readonly string[] }
  | { readonly kind: 'remote_pool' };

// ---------------------------------------------------------------------------------------------
// Modules. Order in each list is the module numbering.
// ---------------------------------------------------------------------------------------------

/** Ops modules, index + 1 = the number in. */
export const OPS_MODULE_IDS = [
  'ops.forecast_explorer', //         1  Forecast Explorer
  'ops.live_dispatch_board', //       2  Live Dispatch Board
  'ops.remote_queue', //              3  Remote Queue and Scheduling
  'ops.field_planner', //             4  Field Planner Workbench
  'ops.standby_coverage', //          5  Standby and Coverage Map
  'ops.gap_surplus', //               6  Gap and Surplus
  'ops.service_level_simulator', //   7  Service-Level Simulator
  'ops.scenario_lab', //              8  Scenario Lab
  'ops.leave_planner', //             9  Leave Planner
  'ops.break_planner', //             10 Break Planner
  'ops.management_dashboards', //     11 Management Dashboards
  'ops.productivity_metrics', //      12 Productivity and Metrics
] as const;

/** Admin modules, index + 1 = the number in. */
export const ADMIN_MODULE_IDS = [
  'admin.users_roles', //             1  Users and Roles
  'admin.sign_in_identity', //        2  Sign-in and Identity Providers
  'admin.locations', //               3  Locations
  'admin.agents_vehicles', //      4  Agents and Vehicles
  'admin.classification_rules', //    5  Classification Rules
  'admin.shift_break_policies', //    6  Shift and Break Policies
  'admin.leave_policy_calendar', //   7  Leave Policy and Calendar
  'admin.forecast_model', //          8  Forecast and Model Admin
  'admin.data_sources', //            9  Data Sources and Integrations
  'admin.data_import_quality', //     10 Data Import and Quality
  'admin.audit_log', //               11 Audit Log
  'admin.notifications_alerts', //    12 Notifications and Alerts
  'admin.api_webhooks', //            13 API and Webhooks
  'admin.security_compliance', //     14 Security and Compliance
  'admin.system_health', //           15 System Health
  'admin.updates', //                 16 Updates
  'admin.localization', //            17 Localization
  'admin.ai_assistant', //            18 AI Assistant
] as const;

export type OpsModuleId = (typeof OPS_MODULE_IDS)[number];
export type AdminModuleId = (typeof ADMIN_MODULE_IDS)[number];
/** Stable module id: '<console>.<slug>'. Also the middle part of the i18n keys. */
export type ModuleId = OpsModuleId | AdminModuleId;

/** All 30 module ids, Ops first, each console in plan order. */
export const MODULE_IDS: readonly ModuleId[] = [...OPS_MODULE_IDS, ...ADMIN_MODULE_IDS];

/** Menu groups. Mapping of modules to groups is in modules.ts. */
export const OPS_GROUPS = ['live', 'plan', 'analyze'] as const;
export const ADMIN_GROUPS = ['access', 'reference_data', 'operations', 'system'] as const;
export type OpsGroup = (typeof OPS_GROUPS)[number];
export type AdminGroup = (typeof ADMIN_GROUPS)[number];
export type GroupId = OpsGroup | AdminGroup;

export interface ModuleDef {
  readonly id: ModuleId;
  readonly console: Console;
  /** Module number: Ops and Admin are numbered separately. */
  readonly number: number;
  readonly group: GroupId;
  /** i18n message key for the page title, 'nav.<id>.title'. */
  readonly titleKey: string;
  /** i18n message key for the menu label, 'nav.<id>.menu'. */
  readonly menuKey: string;
  /** Full module title (used for the PageHeader; English fallback). */
  readonly titleEn: string;
  /** Suggested menu label, 1 to 3 words. The shell may replace it. */
  readonly menuLabelEn: string;
}

/** Result of moduleAccess(). */
export interface ModuleAccessResult {
  readonly access: Access;
  /**
   * True only for the Administrator's Updates item in dedicated and shared installs: the module is
   * in the menu, but the screen shows the version and release notes only.
   */
  readonly reduced: boolean;
}

// ---------------------------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------------------------

/**
 * What is being approved.
 * - rule: a classification rule change.
 * - roster_override: a roster and its overrides.
 * - leave: a leave request.
 * - update: a scheduled update or emergency override.
 */
export const APPROVAL_KINDS = ['rule', 'roster_override', 'leave', 'update'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export interface ApprovalRequest {
  /** The role of the person who is approving. */
  readonly role: Role;
  /** The user who made the request (drafted the rule, built the roster, entered the leave...). */
  readonly requesterUserId: string;
  /** The user who is approving. */
  readonly approverUserId: string;
  readonly kind: ApprovalKind;
  /** Optional. When given, the role must also exist in that install mode. */
  readonly installMode?: InstallMode;
}

export type ApprovalDenial =
  /** An id or enum value is missing or not one of the known values (fail closed). */
  | 'invalid_input'
  /** The role does not exist in this install mode (Change Approver outside private installs). */
  | 'role_not_in_install_mode'
  /** The role is not allowed to approve this kind. */
  | 'role_cannot_approve_kind'
  /** Nobody approves their own request. */
  | 'own_request';

export type ApprovalDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: ApprovalDenial };

// ---------------------------------------------------------------------------------------------
// Runtime guards. Values from a cookie or a form are strings until proven otherwise (CONTRIBUTING.md
// the no default role rule: no match means no access), so every public function fails closed on unknown values.
// ---------------------------------------------------------------------------------------------

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isInstallMode(value: unknown): value is InstallMode {
  return typeof value === 'string' && (INSTALL_MODES as readonly string[]).includes(value);
}

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value);
}

export function isApprovalKind(value: unknown): value is ApprovalKind {
  return typeof value === 'string' && (APPROVAL_KINDS as readonly string[]).includes(value);
}

export function isOpsModuleId(id: ModuleId): id is OpsModuleId {
  return (OPS_MODULE_IDS as readonly string[]).includes(id);
}
