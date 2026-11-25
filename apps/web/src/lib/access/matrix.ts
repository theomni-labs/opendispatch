// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The role x module matrix, transcribed from the role matrix ("Which role sees which console and
 * modules"), plus the tables that go with it: install-mode differences, role availability,
 * scopes and approvers.
 *
 * Read docs: apps/web/src/lib/access/README.md. Anything not specified is marked
 * `assumption` here and in the README.
 *
 * Column order in ROLE_MODULE_ACCESS rows:
 *   administrator, dispatch_supervisor, dispatcher, planner, remote_team_lead, viewer_auditor, change_approver
 *
 * This is the PRIVATE-install matrix. Where an install mode differs, INSTALL_MODE_RULES says so, and
 * a role that does not exist in a mode (Change Approver outside private) is handled by
 * ROLE_INSTALL_MODES. Use the functions in access.ts, not these tables, from screens and data code.
 */

import type { Access, ApprovalKind, InstallMode, ModuleAccessResult, ModuleId, Role, ScopeKind } from './types';

const NONE: Access = 'none';
const VIEW: Access = 'view';
const EDIT: Access = 'edit';

export const ROLE_MODULE_ACCESS: Readonly<Record<ModuleId, Readonly<Record<Role, Access>>>> = {
  // ---- Ops Console. the role matrix: ------------------------------------------
  //   Administrator        All modules, view
  //   Dispatch Supervisor  1 to 12 (edits rosters, overrides, live dispatch in own zones)
  //                        assumption: plan silent on the rest, so edit exactly 2 and 4, view the rest
  //                        (approved default, ). 2 = live dispatch, 4 = rosters and overrides.
  //   Dispatcher           2 Live Dispatch Board (edits), 1 and 5, view
  //   Planner              4 to 11 (edits plans in own zones); 1, 2, 3 and 12, view
  //   Remote Team Lead     3 Remote Queue (edits); 1, 6 and 11, view
  //   Viewer / Auditor     All modules, view
  //   Change Approver      none
  'ops.forecast_explorer': { administrator: VIEW, dispatch_supervisor: VIEW, dispatcher: VIEW, planner: VIEW, remote_team_lead: VIEW, viewer_auditor: VIEW, change_approver: NONE },
  'ops.live_dispatch_board': { administrator: VIEW, dispatch_supervisor: EDIT, dispatcher: EDIT, planner: VIEW, remote_team_lead: NONE, viewer_auditor: VIEW, change_approver: NONE },
  'ops.remote_queue': { administrator: VIEW, dispatch_supervisor: VIEW, dispatcher: NONE, planner: VIEW, remote_team_lead: EDIT, viewer_auditor: VIEW, change_approver: NONE },
  'ops.field_planner': { administrator: VIEW, dispatch_supervisor: EDIT, dispatcher: NONE, planner: EDIT, remote_team_lead: NONE, viewer_auditor: VIEW, change_approver: NONE },
  'ops.standby_coverage': { administrator: VIEW, dispatch_supervisor: VIEW, dispatcher: VIEW, planner: EDIT, remote_team_lead: NONE, viewer_auditor: VIEW, change_approver: NONE },
  'ops.gap_surplus': { administrator: VIEW, dispatch_supervisor: VIEW, dispatcher: NONE, planner: EDIT, remote_team_lead: VIEW, viewer_auditor: VIEW, change_approver: NONE },
  'ops.service_level_simulator': { administrator: VIEW, dispatch_supervisor: VIEW, dispatcher: NONE, planner: EDIT, remote_team_lead: NONE, viewer_auditor: VIEW, change_approver: NONE },
  'ops.scenario_lab': { administrator: VIEW, dispatch_supervisor: VIEW, dispatcher: NONE, planner: EDIT, remote_team_lead: NONE, viewer_auditor: VIEW, change_approver: NONE },
  'ops.leave_planner': { administrator: VIEW, dispatch_supervisor: VIEW, dispatcher: NONE, planner: EDIT, remote_team_lead: NONE, viewer_auditor: VIEW, change_approver: NONE },
  'ops.break_planner': { administrator: VIEW, dispatch_supervisor: VIEW, dispatcher: NONE, planner: EDIT, remote_team_lead: NONE, viewer_auditor: VIEW, change_approver: NONE },
  'ops.management_dashboards': { administrator: VIEW, dispatch_supervisor: VIEW, dispatcher: NONE, planner: EDIT, remote_team_lead: VIEW, viewer_auditor: VIEW, change_approver: NONE },
  'ops.productivity_metrics': { administrator: VIEW, dispatch_supervisor: VIEW, dispatcher: NONE, planner: VIEW, remote_team_lead: NONE, viewer_auditor: VIEW, change_approver: NONE },

  // ---- Admin Console. the role matrix: -----------------------------------------
  //   Administrator        All 17
  //   Dispatch Supervisor  5 Classification Rules (approve or reject; second role in flow 1)
  //   Dispatcher, Planner, Remote Team Lead   none
  //   Viewer / Auditor     11 Audit Log, view
  //   Change Approver      16 Updates (approve or reject), 11 Audit Log, view
  //
  // Approve or reject is not an Access level. It is modelled as 'view' here plus the approval
  // tables below (APPROVER_ROLES, APPROVAL_MODULE), so the Supervisor cannot draft rules and the
  // Change Approver cannot apply or schedule updates. assumption: this mapping of "approve or reject" to 'view'.
  'admin.users_roles': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  // Plan 6.2 #2: read-only for the Administrator in the shared tier. See INSTALL_MODE_RULES.
  'admin.sign_in_identity': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.locations': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.agents_vehicles': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.classification_rules': { administrator: EDIT, dispatch_supervisor: VIEW, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.shift_break_policies': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.leave_policy_calendar': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.forecast_model': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.data_sources': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.data_import_quality': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  // assumption: 'view' for the Administrator. the role matrix says "All 17" without saying edit, and the
  // audit log is append only, so there is nothing to edit; 'edit' would only invite the
  // shell to draw controls that must not exist.
  'admin.audit_log': { administrator: VIEW, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: VIEW, change_approver: VIEW },
  'admin.notifications_alerts': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.api_webhooks': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.security_compliance': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  'admin.system_health': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  // Plan 6.2 #16: full screen in private installs. Dedicated and shared: see INSTALL_MODE_RULES.
  'admin.updates': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: VIEW },
  'admin.localization': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: NONE, change_approver: NONE },
  // Admin 18
  'admin.ai_assistant': { administrator: EDIT, dispatch_supervisor: NONE, dispatcher: NONE, planner: NONE, remote_team_lead: NONE, viewer_auditor: VIEW, change_approver: NONE },
};

// ---------------------------------------------------------------------------------------------
// Install-mode differences
// ---------------------------------------------------------------------------------------------

export interface InstallModeRule {
  readonly moduleId: ModuleId;
  readonly role: Role;
  readonly modes: readonly InstallMode[];
  /** Replaces the ROLE_MODULE_ACCESS cell in those modes. */
  readonly result: ModuleAccessResult;
}

export const INSTALL_MODE_RULES: readonly InstallModeRule[] = [
  // Plan 6.2 #16 and the Administrator keeps the Updates menu item in EVERY
  // install mode. Dedicated and shared: same module id, read-only, version and release notes only.
  { moduleId: 'admin.updates', role: 'administrator', modes: ['dedicated', 'shared'], result: { access: 'view', reduced: true } },
  // Plan 6.2 #2: Sign-in and Identity Providers is read-only for the Administrator in the shared
  // tier, where our staff set providers up from the Operator Console. Stated in and section 7,
  // not in the role matrix table. Full screen, so not `reduced`.
  { moduleId: 'admin.sign_in_identity', role: 'administrator', modes: ['shared'], result: { access: 'view', reduced: false } },
];

/**
 * Which install modes a role exists in. Change Approver exists only in private installs (the role matrix,
 * ); in dedicated and shared installs our staff approve updates.
 */
export const ROLE_INSTALL_MODES: Readonly<Record<Role, readonly InstallMode[]>> = {
  administrator: ['private', 'dedicated', 'shared'],
  dispatch_supervisor: ['private', 'dedicated', 'shared'],
  dispatcher: ['private', 'dedicated', 'shared'],
  planner: ['private', 'dedicated', 'shared'],
  remote_team_lead: ['private', 'dedicated', 'shared'],
  viewer_auditor: ['private', 'dedicated', 'shared'],
  change_approver: ['private'],
};

// ---------------------------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------------------------

export const SCOPE_BY_ROLE: Readonly<Record<Role, ScopeKind>> = {
  administrator: 'whole_install',
  dispatch_supervisor: 'assigned_zones',
  dispatcher: 'assigned_zones',
  planner: 'assigned_zones',
  remote_team_lead: 'remote_pool',
  viewer_auditor: 'whole_install',
  change_approver: 'whole_install',
};

// ---------------------------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------------------------

/**
 * Which roles may approve which kind of request. "Nobody approves their own request" is applied on
 * top of this, see checkApproval() in access.ts.
 *
 * - rule: Dispatch Supervisor. Flow 1: the Administrator drafts and submits, a Dispatch Supervisor
 *   approves. the role matrix: "5 Classification Rules (approve or reject; ... second role in flow 1)".
 * - roster_override: Dispatch Supervisor. Flow 2 "supervisor approves"; the role matrix role table
 *   "approve overrides". The Planner builds and submits.
 * - leave: Planner. assumption: the requirement says only "approve or decline" and names no role.
 *   The Planner is the only role with edit access to the Leave Planner (module 9), and the Supervisor
 *   is view-only there under the approved default, so the approver is the role that can edit it.
 * - update: Change Approver (private installs only). Plan 9.6: "Approvers: people with the Change
 *   Approver role". The Administrator applies or schedules; the Administrator does not approve.
 */
export const APPROVER_ROLES: Readonly<Record<ApprovalKind, readonly Role[]>> = {
  rule: ['dispatch_supervisor'],
  roster_override: ['dispatch_supervisor'],
  leave: ['planner'],
  update: ['change_approver'],
};

/** The module each kind of approval is done in. Used for the default landing page. */
export const APPROVAL_MODULE: Readonly<Record<ApprovalKind, ModuleId>> = {
  rule: 'admin.classification_rules',
  roster_override: 'ops.field_planner',
  leave: 'ops.leave_planner',
  update: 'admin.updates',
};
