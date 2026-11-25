// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ADMIN_MODULE_IDS, GROUPS, MODULES, MODULE_IDS, OPS_MODULE_IDS, getModule, modulesOf } from './index';

// Independent literals, typed out from the product specification sections 6.1 and 6.2. They are NOT
// derived from modules.ts. Format: [plan number, module id, plan title, group].
const PLAN_OPS = [
  [1, 'ops.forecast_explorer', 'Forecast Explorer', 'plan'],
  [2, 'ops.live_dispatch_board', 'Live Dispatch Board', 'live'],
  [3, 'ops.remote_queue', 'Remote Queue and Scheduling', 'live'],
  [4, 'ops.field_planner', 'Field Planner Workbench', 'plan'],
  [5, 'ops.standby_coverage', 'Standby and Coverage Map', 'plan'],
  [6, 'ops.gap_surplus', 'Gap and Surplus', 'analyze'],
  [7, 'ops.service_level_simulator', 'Service-Level Simulator', 'analyze'],
  [8, 'ops.scenario_lab', 'Scenario Lab', 'analyze'],
  [9, 'ops.leave_planner', 'Leave Planner', 'plan'],
  [10, 'ops.break_planner', 'Break Planner', 'plan'],
  [11, 'ops.management_dashboards', 'Management Dashboards', 'analyze'],
  [12, 'ops.productivity_metrics', 'Productivity and Metrics', 'analyze'],
] as const;

const PLAN_ADMIN = [
  [1, 'admin.users_roles', 'Users and Roles', 'access'],
  [2, 'admin.sign_in_identity', 'Sign-in and Identity Providers', 'access'],
  [3, 'admin.locations', 'Locations', 'reference_data'],
  [4, 'admin.agents_vehicles', 'Agents and Vehicles', 'reference_data'],
  [5, 'admin.classification_rules', 'Classification Rules', 'reference_data'],
  [6, 'admin.shift_break_policies', 'Shift and Break Policies', 'reference_data'],
  [7, 'admin.leave_policy_calendar', 'Leave Policy and Calendar', 'reference_data'],
  [8, 'admin.forecast_model', 'Forecast and Model Admin', 'operations'],
  [9, 'admin.data_sources', 'Data Sources and Integrations', 'operations'],
  [10, 'admin.data_import_quality', 'Data Import and Quality', 'operations'],
  [11, 'admin.audit_log', 'Audit Log', 'system'],
  [12, 'admin.notifications_alerts', 'Notifications and Alerts', 'operations'],
  [13, 'admin.api_webhooks', 'API and Webhooks', 'operations'],
  [14, 'admin.security_compliance', 'Security and Compliance', 'system'],
  [15, 'admin.system_health', 'System Health', 'system'],
  [16, 'admin.updates', 'Updates', 'system'],
  [17, 'admin.localization', 'Localization', 'system'],
  [18, 'admin.ai_assistant', 'AI Assistant', 'system'],
] as const;

describe('module list', () => {
  it('has exactly 30 modules: 12 Ops and 18 Admin', () => {
    expect(MODULES).toHaveLength(30);
    expect(MODULE_IDS).toHaveLength(30);
    expect(OPS_MODULE_IDS).toHaveLength(12);
    expect(ADMIN_MODULE_IDS).toHaveLength(18);
    expect(modulesOf('ops')).toHaveLength(12);
    expect(modulesOf('admin')).toHaveLength(18);
    expect(PLAN_OPS.length + PLAN_ADMIN.length).toBe(30);
  });

  it.each([
    ['ops', PLAN_OPS],
    ['admin', PLAN_ADMIN],
  ] as const)('%s modules match the module numbering, ids, titles and groups', (consoleId, plan) => {
    const actual = modulesOf(consoleId).map((m) => [m.number, m.id, m.titleEn, m.group]);
    expect(actual).toEqual(plan.map((row) => [...row]));
  });

  it('lists modules in plan order: Ops 1 to 12, then Admin 1 to 18', () => {
    expect(MODULES.map((m) => `${m.console}:${m.number}`)).toEqual([
      ...PLAN_OPS.map(([n]) => `ops:${n}`),
      ...PLAN_ADMIN.map(([n]) => `admin:${n}`),
    ]);
  });

  it('has unique ids, title keys and menu keys', () => {
    const ids = MODULES.map((m) => m.id);
    const titleKeys = MODULES.map((m) => m.titleKey);
    const menuKeys = MODULES.map((m) => m.menuKey);
    expect(new Set(ids).size).toBe(30);
    expect(new Set(titleKeys).size).toBe(30);
    expect(new Set(menuKeys).size).toBe(30);
    expect(new Set([...titleKeys, ...menuKeys]).size).toBe(60);
  });

  it('builds i18n keys from the id and prefixes the id with its console', () => {
    for (const m of MODULES) {
      expect(m.titleKey).toBe(`nav.${m.id}.title`);
      expect(m.menuKey).toBe(`nav.${m.id}.menu`);
      expect(m.id.startsWith(`${m.console}.`)).toBe(true);
    }
    expect(getModule('ops.live_dispatch_board').titleKey).toBe('nav.ops.live_dispatch_board.title');
    expect(getModule('admin.updates').menuKey).toBe('nav.admin.updates.menu');
  });

  it('gives every module a menu label of 1 to 3 words and a plan title', () => {
    for (const m of MODULES) {
      const words = m.menuLabelEn.trim().split(/\s+/);
      expect(words.length, m.id).toBeGreaterThanOrEqual(1);
      expect(words.length, m.id).toBeLessThanOrEqual(3);
      expect(m.menuLabelEn, m.id).toBe(m.menuLabelEn.trim());
      expect(m.titleEn.length, m.id).toBeGreaterThan(0);
    }
  });

  it('getModule returns the definition for every id', () => {
    for (const id of MODULE_IDS) {
      expect(getModule(id).id).toBe(id);
    }
  });

  it('is immutable at runtime', () => {
    expect(Object.isFrozen(MODULES)).toBe(true);
    expect(Object.isFrozen(getModule('admin.updates'))).toBe(true);
    expect(Object.isFrozen(GROUPS)).toBe(true);
  });
});

describe('groups', () => {
  it('are Ops Live, Plan, Analyze then Admin Access, Reference data, Operations, System, in that order', () => {
    expect(GROUPS.map((g) => [g.console, g.id])).toEqual([
      ['ops', 'live'],
      ['ops', 'plan'],
      ['ops', 'analyze'],
      ['admin', 'access'],
      ['admin', 'reference_data'],
      ['admin', 'operations'],
      ['admin', 'system'],
    ]);
  });

  it('have unique i18n keys built from console and id', () => {
    expect(new Set(GROUPS.map((g) => g.groupKey)).size).toBe(GROUPS.length);
    for (const g of GROUPS) {
      expect(g.groupKey).toBe(`nav.${g.console}.group.${g.id}`);
    }
  });

  it('are never empty, and every module sits in a group of its own console', () => {
    for (const g of GROUPS) {
      expect(MODULES.filter((m) => m.group === g.id).length, g.id).toBeGreaterThan(0);
    }
    for (const m of MODULES) {
      const g = GROUPS.find((x) => x.id === m.group);
      expect(g?.console, m.id).toBe(m.console);
    }
  });

  it('keep plan number order inside each group', () => {
    for (const g of GROUPS) {
      const numbers = MODULES.filter((m) => m.group === g.id).map((m) => m.number);
      expect(numbers, g.id).toEqual([...numbers].sort((a, b) => a - b));
    }
  });
});
