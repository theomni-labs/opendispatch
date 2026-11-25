// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The 30 module definitions and the menu groups.
 *
 * Group mapping ("Defaults taken": Ops groups Live, Plan, Analyze; Admin groups Access,
 * Reference data, Operations, System). The plan gives flat numbered lists, so the assignment below
 * follows the intended design. Inside a group, items keep the module number order.
 *
 *   Ops    Live      2 Live Dispatch Board, 3 Remote Queue and Scheduling
 *          Plan      1 Forecast Explorer, 4 Field Planner Workbench, 5 Standby and Coverage Map,
 *                    9 Leave Planner, 10 Break Planner
 *          Analyze   6 Gap and Surplus, 7 Service-Level Simulator, 8 Scenario Lab,
 *                    11 Management Dashboards, 12 Productivity and Metrics
 *   Admin  Access          1 Users and Roles, 2 Sign-in and Identity Providers
 *          Reference data  3 Locations, 4 Agents and Vehicles, 5 Classification Rules,
 *                          6 Shift and Break Policies, 7 Leave Policy and Calendar
 *          Operations      8 Forecast and Model Admin, 9 Data Sources and Integrations,
 *                          10 Data Import and Quality, 12 Notifications and Alerts, 13 API and Webhooks
 *          System          11 Audit Log, 14 Security and Compliance, 15 System Health, 16 Updates,
 *                          17 Localization, 18 AI Assistant
 *
 * i18n keys: titleKey 'nav.<id>.title', menuKey 'nav.<id>.menu', group label 'nav.<console>.group.<group>'.
 * menuLabelEn is a suggestion (1 to 3 words, the specification); the shell decides the final short labels.
 */

import type { Console, GroupId, ModuleDef, ModuleId } from './types';
import { MODULE_IDS, isOpsModuleId } from './types';

// ---------------------------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------------------------

export interface GroupDef {
  readonly console: Console;
  readonly id: GroupId;
  /** i18n message key for the group label: 'nav.<console>.group.<id>'. */
  readonly groupKey: string;
  readonly labelEn: string;
}

function group(console: Console, id: GroupId, labelEn: string): GroupDef {
  return Object.freeze({ console, id, groupKey: `nav.${console}.group.${id}`, labelEn });
}

/** Menu order: Ops groups first, then Admin groups. */
export const GROUPS: readonly GroupDef[] = Object.freeze([
  group('ops', 'live', 'Live'),
  group('ops', 'plan', 'Plan'),
  group('ops', 'analyze', 'Analyze'),
  group('admin', 'access', 'Access'),
  group('admin', 'reference_data', 'Reference data'),
  group('admin', 'operations', 'Operations'),
  group('admin', 'system', 'System'),
]);

// ---------------------------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------------------------

interface ModuleSpec {
  readonly number: number;
  readonly group: GroupId;
  /** Exactly as in / 6.2. */
  readonly titleEn: string;
  /** 1 to 3 words. Where the module title is longer, a shortened form (a suggestion). */
  readonly menuLabelEn: string;
}

/** Keyed by ModuleId, so a missing or extra module is a compile error. */
const SPECS: Readonly<Record<ModuleId, ModuleSpec>> = {
  // Ops Console
  'ops.forecast_explorer': { number: 1, group: 'plan', titleEn: 'Forecast Explorer', menuLabelEn: 'Forecast Explorer' },
  'ops.live_dispatch_board': { number: 2, group: 'live', titleEn: 'Live Dispatch Board', menuLabelEn: 'Live Dispatch Board' },
  'ops.remote_queue': { number: 3, group: 'live', titleEn: 'Remote Queue and Scheduling', menuLabelEn: 'Remote Queue' },
  'ops.field_planner': { number: 4, group: 'plan', titleEn: 'Field Planner Workbench', menuLabelEn: 'Field Planner' },
  'ops.standby_coverage': { number: 5, group: 'plan', titleEn: 'Standby and Coverage Map', menuLabelEn: 'Standby and Coverage' },
  'ops.gap_surplus': { number: 6, group: 'analyze', titleEn: 'Gap and Surplus', menuLabelEn: 'Gap and Surplus' },
  'ops.service_level_simulator': { number: 7, group: 'analyze', titleEn: 'Service-Level Simulator', menuLabelEn: 'Service-Level Simulator' },
  'ops.scenario_lab': { number: 8, group: 'analyze', titleEn: 'Scenario Lab', menuLabelEn: 'Scenario Lab' },
  'ops.leave_planner': { number: 9, group: 'plan', titleEn: 'Leave Planner', menuLabelEn: 'Leave Planner' },
  'ops.break_planner': { number: 10, group: 'plan', titleEn: 'Break Planner', menuLabelEn: 'Break Planner' },
  'ops.management_dashboards': { number: 11, group: 'analyze', titleEn: 'Management Dashboards', menuLabelEn: 'Management Dashboards' },
  'ops.productivity_metrics': { number: 12, group: 'analyze', titleEn: 'Productivity and Metrics', menuLabelEn: 'Productivity and Metrics' },

  // Admin Console
  'admin.users_roles': { number: 1, group: 'access', titleEn: 'Users and Roles', menuLabelEn: 'Users and Roles' },
  'admin.sign_in_identity': { number: 2, group: 'access', titleEn: 'Sign-in and Identity Providers', menuLabelEn: 'Identity Providers' },
  'admin.locations': { number: 3, group: 'reference_data', titleEn: 'Locations', menuLabelEn: 'Locations' },
  'admin.agents_vehicles': { number: 4, group: 'reference_data', titleEn: 'Agents and Vehicles', menuLabelEn: 'Agents and Vehicles' },
  'admin.classification_rules': { number: 5, group: 'reference_data', titleEn: 'Classification Rules', menuLabelEn: 'Classification Rules' },
  'admin.shift_break_policies': { number: 6, group: 'reference_data', titleEn: 'Shift and Break Policies', menuLabelEn: 'Shifts and Breaks' },
  'admin.leave_policy_calendar': { number: 7, group: 'reference_data', titleEn: 'Leave Policy and Calendar', menuLabelEn: 'Leave and Calendar' },
  'admin.forecast_model': { number: 8, group: 'operations', titleEn: 'Forecast and Model Admin', menuLabelEn: 'Model Admin' },
  'admin.data_sources': { number: 9, group: 'operations', titleEn: 'Data Sources and Integrations', menuLabelEn: 'Data Sources' },
  'admin.data_import_quality': { number: 10, group: 'operations', titleEn: 'Data Import and Quality', menuLabelEn: 'Import and Quality' },
  'admin.audit_log': { number: 11, group: 'system', titleEn: 'Audit Log', menuLabelEn: 'Audit Log' },
  'admin.notifications_alerts': { number: 12, group: 'operations', titleEn: 'Notifications and Alerts', menuLabelEn: 'Notifications and Alerts' },
  'admin.api_webhooks': { number: 13, group: 'operations', titleEn: 'API and Webhooks', menuLabelEn: 'API and Webhooks' },
  'admin.security_compliance': { number: 14, group: 'system', titleEn: 'Security and Compliance', menuLabelEn: 'Security and Compliance' },
  'admin.system_health': { number: 15, group: 'system', titleEn: 'System Health', menuLabelEn: 'System Health' },
  'admin.updates': { number: 16, group: 'system', titleEn: 'Updates', menuLabelEn: 'Updates' },
  'admin.localization': { number: 17, group: 'system', titleEn: 'Localization', menuLabelEn: 'Localization' },
  'admin.ai_assistant': { number: 18, group: 'system', titleEn: 'AI Assistant', menuLabelEn: 'AI Assistant' },
};

function moduleDef(id: ModuleId, spec: ModuleSpec): ModuleDef {
  return Object.freeze({
    id,
    console: isOpsModuleId(id) ? 'ops' : 'admin',
    number: spec.number,
    group: spec.group,
    titleKey: `nav.${id}.title`,
    menuKey: `nav.${id}.menu`,
    titleEn: spec.titleEn,
    menuLabelEn: spec.menuLabelEn,
  });
}

/** All 30 modules: Ops 1 to 12, then Admin 1 to 18, each in plan order. */
export const MODULES: readonly ModuleDef[] = Object.freeze(MODULE_IDS.map((id) => moduleDef(id, SPECS[id])));

const BY_ID: ReadonlyMap<ModuleId, ModuleDef> = new Map(MODULES.map((m) => [m.id, m]));

/** The definition for a module id. Every ModuleId has one, so this cannot fail for typed input. */
export function getModule(id: ModuleId): ModuleDef {
  const found = BY_ID.get(id);
  if (found === undefined) throw new Error(`Unknown module id: ${id}`);
  return found;
}

/** The modules of one console, in plan order. */
export function modulesOf(console: Console): readonly ModuleDef[] {
  return MODULES.filter((m) => m.console === console);
}
