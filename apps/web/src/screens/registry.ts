// SPDX-License-Identifier: AGPL-3.0-only
// The Admin and Ops screen registries.
// ModuleRoute asks one of
// them for a module's screen; a module with none
// yet gets the placeholder page (ModulePage).
//
// HOW TO ADD A SCREEN. This file never changes
// except to add one loader line below (Admin's 17
// already exist). Each module has its own
// `screens/<console>/<module>/index.ts`, starting as
//
//     import type { Screen } from '@/screens/types';
//     export const screen: Screen | undefined =
//       undefined;
//
// and when the screen exists becomes
//
//     import type { Screen } from '@/screens/types';
//     import { UsersRolesScreen } from './Screen';
//     export const screen: Screen =
//       UsersRolesScreen;
//
// `<module>` is the module id after `admin.` or
// `ops.`, matching the folder under messages/admin
// or messages/ops. Each loader line loads its
// index lazily, so a page pays for its own screen
// only. An index.ts must not run anything at
// import time.
//
// ADMIN_SCREEN_LOADERS is a complete
// `Record<AdminModuleId,...>`: all 17 Admin
// modules were built , one milestone, so the
// compiler refuses a missing entry.
// OPS_SCREEN_LOADERS is a
// `Partial<Record<OpsModuleId,...>>` on purpose:
// The build has the 12 Ops modules incrementally, so
// requiring all 12 today would mean stub folders
// for modules nobody has started. loadOpsScreen
// falls back to the placeholder for a module id
// with no entry yet. Add a module's line here as
// its screen is built; nothing else changes.

import type { AdminModuleId, OpsModuleId } from '@/lib/access';
import type { AdminScreen, ScreenModule } from './types';

export const ADMIN_SCREEN_LOADERS: Readonly<Record<AdminModuleId, () => Promise<ScreenModule>>> = {
  'admin.users_roles': () => import('./admin/users_roles'),
  'admin.sign_in_identity': () => import('./admin/sign_in_identity'),
  'admin.locations': () => import('./admin/locations'),
  'admin.agents_vehicles': () => import('./admin/agents_vehicles'),
  'admin.classification_rules': () => import('./admin/classification_rules'),
  'admin.shift_break_policies': () => import('./admin/shift_break_policies'),
  'admin.leave_policy_calendar': () => import('./admin/leave_policy_calendar'),
  'admin.forecast_model': () => import('./admin/forecast_model'),
  'admin.data_sources': () => import('./admin/data_sources'),
  'admin.data_import_quality': () => import('./admin/data_import_quality'),
  'admin.audit_log': () => import('./admin/audit_log'),
  'admin.notifications_alerts': () => import('./admin/notifications_alerts'),
  'admin.api_webhooks': () => import('./admin/api_webhooks'),
  'admin.security_compliance': () => import('./admin/security_compliance'),
  'admin.system_health': () => import('./admin/system_health'),
  'admin.updates': () => import('./admin/updates'),
  'admin.localization': () => import('./admin/localization'),
  'admin.ai_assistant': () => import('./admin/ai_assistant'),
};

export const OPS_SCREEN_LOADERS: Readonly<Partial<Record<OpsModuleId, () => Promise<ScreenModule>>>> = {
  'ops.break_planner': () => import('./ops/break_planner'),
  'ops.field_planner': () => import('./ops/field_planner'),
  'ops.forecast_explorer': () => import('./ops/forecast_explorer'),
  'ops.gap_surplus': () => import('./ops/gap_surplus'),
  'ops.leave_planner': () => import('./ops/leave_planner'),
  'ops.live_dispatch_board': () => import('./ops/live_dispatch_board'),
  'ops.management_dashboards': () => import('./ops/management_dashboards'),
  'ops.productivity_metrics': () => import('./ops/productivity_metrics'),
  'ops.remote_queue': () => import('./ops/remote_queue'),
  'ops.scenario_lab': () => import('./ops/scenario_lab'),
  'ops.service_level_simulator': () => import('./ops/service_level_simulator'),
  'ops.standby_coverage': () => import('./ops/standby_coverage'),
};

/**
 * The registered screen of an Admin module, or undefined: the module has none yet (show the placeholder), or the id is an
 * Ops module or unknown. Never throws for an id it does not know.
 */
export async function loadAdminScreen(moduleId: string): Promise<AdminScreen | undefined> {
  if (!Object.hasOwn(ADMIN_SCREEN_LOADERS, moduleId)) return undefined;
  const load = ADMIN_SCREEN_LOADERS[moduleId as AdminModuleId];
  return (await load()).screen;
}

/**
 * The registered screen of an Ops module, or undefined: the module has none yet (show the placeholder, same as every Ops
 * module ), or the id is an Admin module or unknown. Never throws for an id it does not know.
 */
export async function loadOpsScreen(moduleId: string): Promise<AdminScreen | undefined> {
  if (!Object.hasOwn(OPS_SCREEN_LOADERS, moduleId)) return undefined;
  const load = OPS_SCREEN_LOADERS[moduleId as OpsModuleId];
  return (await load?.())?.screen;
}
