// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ROLE_MODULE_ACCESS, MODULE_IDS, ROLES, menuFor, moduleAccess } from './index';
import type { Access, Console, GroupId, InstallMode, ModuleId, Role } from './index';

// ------------------------------------------------------------------------------------------------
// Independent literal tables, typed out from the product specification the role matrix ("Which role sees
// which console and modules") and the derived per-role menus in plan_tail_report.md section 4.3.
// Nothing below is computed from the implementation's matrix or module list.
//
// Module numbers: Ops and Admin are numbered separately.
// ------------------------------------------------------------------------------------------------

const OPS_ID_BY_NUMBER: readonly ModuleId[] = [
  'ops.forecast_explorer', // 1
  'ops.live_dispatch_board', // 2
  'ops.remote_queue', // 3
  'ops.field_planner', // 4
  'ops.standby_coverage', // 5
  'ops.gap_surplus', // 6
  'ops.service_level_simulator', // 7
  'ops.scenario_lab', // 8
  'ops.leave_planner', // 9
  'ops.break_planner', // 10
  'ops.management_dashboards', // 11
  'ops.productivity_metrics', // 12
];

const ADMIN_ID_BY_NUMBER: readonly ModuleId[] = [
  'admin.users_roles', // 1
  'admin.sign_in_identity', // 2
  'admin.locations', // 3
  'admin.agents_vehicles', // 4
  'admin.classification_rules', // 5
  'admin.shift_break_policies', // 6
  'admin.leave_policy_calendar', // 7
  'admin.forecast_model', // 8
  'admin.data_sources', // 9
  'admin.data_import_quality', // 10
  'admin.audit_log', // 11
  'admin.notifications_alerts', // 12
  'admin.api_webhooks', // 13
  'admin.security_compliance', // 14
  'admin.system_health', // 15
  'admin.updates', // 16
  'admin.localization', // 17
  'admin.ai_assistant', // 18
];

interface Cells {
  readonly edit: readonly number[];
  readonly view: readonly number[];
}

/** the role matrix, Ops Console column. Approve-or-reject roles are 'view' here (see README). */
const EXPECTED_OPS: Readonly<Record<Role, Cells>> = {
  // "All modules, view"
  administrator: { edit: [], view: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  // "1 to 12 (edits rosters, overrides, live dispatch in own zones)": edit 4 (rosters, overrides)
  // and 2 (live dispatch); view the rest (approved default).
  dispatch_supervisor: { edit: [2, 4], view: [1, 3, 5, 6, 7, 8, 9, 10, 11, 12] },
  // "2 Live Dispatch Board (edits), 1 and 5, view"
  dispatcher: { edit: [2], view: [1, 5] },
  // "4 to 11 (edits plans in own zones); 1, 2, 3 and 12, view"
  planner: { edit: [4, 5, 6, 7, 8, 9, 10, 11], view: [1, 2, 3, 12] },
  // "3 Remote Queue (edits); 1, 6 and 11, view"
  remote_team_lead: { edit: [3], view: [1, 6, 11] },
  // "All modules, view"
  viewer_auditor: { edit: [], view: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  // "none"
  change_approver: { edit: [], view: [] },
};

/** the role matrix, Admin Console column, in a PRIVATE install. */
const EXPECTED_ADMIN_PRIVATE: Readonly<Record<Role, Cells>> = {
  // "All 17". Audit Log (11) is view: append only (assumption, see README).
  administrator: { edit: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18], view: [11] },
  // "5 Classification Rules (approve or reject ...)": approve is not edit, so view.
  dispatch_supervisor: { edit: [], view: [5] },
  dispatcher: { edit: [], view: [] },
  planner: { edit: [], view: [] },
  remote_team_lead: { edit: [], view: [] },
  // "11 Audit Log, view"; 18 AI Assistant, view
  viewer_auditor: { edit: [], view: [11, 18] },
  // "16 Updates (approve or reject), 11 Audit Log, view"
  change_approver: { edit: [], view: [11, 16] },
};

/** Derived menus (plan_tail_report 4.3) as [console, [group, item numbers][]][], private install. */
type ExpectedMenu = ReadonlyArray<readonly [Console, ReadonlyArray<readonly [GroupId, readonly number[]]>]>;

const OPS_FULL: ExpectedMenu[number] = [
  'ops',
  [
    ['live', [2, 3]],
    ['plan', [1, 4, 5, 9, 10]],
    ['analyze', [6, 7, 8, 11, 12]],
  ],
];

const EXPECTED_MENU: Readonly<Record<Role, ExpectedMenu>> = {
  administrator: [
    OPS_FULL,
    [
      'admin',
      [
        ['access', [1, 2]],
        ['reference_data', [3, 4, 5, 6, 7]],
        ['operations', [8, 9, 10, 12, 13]],
        ['system', [11, 14, 15, 16, 17, 18]],
      ],
    ],
  ],
  dispatch_supervisor: [OPS_FULL, ['admin', [['reference_data', [5]]]]],
  dispatcher: [
    [
      'ops',
      [
        ['live', [2]],
        ['plan', [1, 5]],
      ],
    ],
  ],
  planner: [OPS_FULL],
  remote_team_lead: [
    [
      'ops',
      [
        ['live', [3]],
        ['plan', [1]],
        ['analyze', [6, 11]],
      ],
    ],
  ],
  viewer_auditor: [OPS_FULL, ['admin', [['system', [11, 18]]]]],
  change_approver: [['admin', [['system', [11, 16]]]]],
};

/** plan_tail_report 4.3, "Item count Ops / Admin". */
const EXPECTED_COUNTS: Readonly<Record<Role, readonly [number, number]>> = {
  administrator: [12, 18],
  dispatch_supervisor: [12, 1],
  dispatcher: [3, 0],
  planner: [12, 0],
  remote_team_lead: [4, 0],
  viewer_auditor: [12, 2],
  change_approver: [0, 2],
};

const MODES: readonly InstallMode[] = ['private', 'dedicated', 'shared'];
const SIX_ROLES: readonly Role[] = ROLES.filter((r) => r !== 'change_approver');

function levelFor(cells: Cells, n: number): Access {
  if (cells.edit.includes(n)) return 'edit';
  if (cells.view.includes(n)) return 'view';
  return 'none';
}

/** Expected access for every module id, from the literal tables, in a private install. */
function expectedPrivate(role: Role): Map<ModuleId, Access> {
  const out = new Map<ModuleId, Access>();
  OPS_ID_BY_NUMBER.forEach((id, i) => out.set(id, levelFor(EXPECTED_OPS[role], i + 1)));
  ADMIN_ID_BY_NUMBER.forEach((id, i) => out.set(id, levelFor(EXPECTED_ADMIN_PRIVATE[role], i + 1)));
  return out;
}

function menuAsNumbers(role: Role, mode: InstallMode) {
  return menuFor(role, mode).map((c) => [c.console, c.groups.map((g) => [g.group, g.items.map((m) => m.number)])]);
}

describe('Appendix C matrix (private install)', () => {
  it('literal tables cover all 30 modules', () => {
    expect(OPS_ID_BY_NUMBER).toHaveLength(12);
    expect(ADMIN_ID_BY_NUMBER).toHaveLength(18);
    expect(new Set([...OPS_ID_BY_NUMBER, ...ADMIN_ID_BY_NUMBER])).toEqual(new Set(MODULE_IDS));
  });

  it.each(ROLES)('%s: access to every one of the 30 modules matches Appendix C', (role) => {
    for (const [id, expected] of expectedPrivate(role)) {
      expect(moduleAccess(role, id, 'private'), `${role} / ${id}`).toEqual({ access: expected, reduced: false });
    }
  });

  it.each(ROLES)('%s: menu equals the derived per-role menu, group by group', (role) => {
    expect(menuAsNumbers(role, 'private')).toEqual(EXPECTED_MENU[role].map(([c, gs]) => [c, gs.map(([g, ns]) => [g, [...ns]])]));
  });

  it.each(ROLES)('%s: item count per console matches the derived table', (role) => {
    const counts = (['ops', 'admin'] as const).map((consoleId) =>
      menuFor(role, 'private')
        .filter((c) => c.console === consoleId)
        .flatMap((c) => c.groups.flatMap((g) => g.items)).length,
    );
    expect(counts).toEqual([...EXPECTED_COUNTS[role]]);
  });

  it('the Administrator sees every Ops module view-only and 17 of 18 Admin modules as edit', () => {
    for (const id of OPS_ID_BY_NUMBER) {
      expect(moduleAccess('administrator', id, 'private').access, id).toBe('view');
    }
    const adminAccess = ADMIN_ID_BY_NUMBER.map((id) => moduleAccess('administrator', id, 'private').access);
    expect(adminAccess.filter((a) => a === 'none')).toHaveLength(0);
    expect(adminAccess.filter((a) => a === 'edit')).toHaveLength(17);
  });

  it('the Dispatch Supervisor edits exactly Live Dispatch Board and Field Planner Workbench in Ops', () => {
    const edits = OPS_ID_BY_NUMBER.filter((id) => moduleAccess('dispatch_supervisor', id, 'private').access === 'edit');
    expect(edits).toEqual(['ops.live_dispatch_board', 'ops.field_planner']);
  });

  it('Viewer / Auditor has no edit access anywhere', () => {
    for (const id of MODULE_IDS) {
      expect(moduleAccess('viewer_auditor', id, 'private').access, id).not.toBe('edit');
    }
  });

  it('only the Administrator, Planner, Dispatch Supervisor, Dispatcher and Remote Team Lead can edit anything', () => {
    const editors = ROLES.filter((role) => MODULE_IDS.some((id) => moduleAccess(role, id, 'private').access === 'edit'));
    expect(editors).toEqual(['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead']);
  });

  it('the stored matrix has all seven roles for every module', () => {
    for (const id of MODULE_IDS) {
      expect(Object.keys(ROLE_MODULE_ACCESS[id]).sort(), id).toEqual([...ROLES].sort());
    }
  });
});

describe('menus in every install mode', () => {
  it.each(MODES)('%s: no menu item has access none, and every module left out has access none', (mode) => {
    for (const role of ROLES) {
      const inMenu = new Set(menuFor(role, mode).flatMap((c) => c.groups.flatMap((g) => g.items.map((m) => m.id))));
      for (const id of MODULE_IDS) {
        const { access } = moduleAccess(role, id, mode);
        if (inMenu.has(id)) expect(access, `${role} / ${id} / ${mode}`).not.toBe('none');
        else expect(access, `${role} / ${id} / ${mode}`).toBe('none');
      }
    }
  });

  it.each(['dedicated', 'shared'] as const)('%s: the six roles get the same menu as in a private install', (mode) => {
    for (const role of SIX_ROLES) {
      expect(menuAsNumbers(role, mode), role).toEqual(menuAsNumbers(role, 'private'));
    }
  });

  it.each(['dedicated', 'shared'] as const)(
    '%s: access matches Appendix C except the two plan-stated Administrator differences',
    (mode) => {
      for (const role of SIX_ROLES) {
        for (const [id, expected] of expectedPrivate(role)) {
          let want: { access: Access; reduced: boolean } = { access: expected, reduced: false };
          if (role === 'administrator' && id === 'admin.updates') want = { access: 'view', reduced: true };
          if (role === 'administrator' && id === 'admin.sign_in_identity' && mode === 'shared') want = { access: 'view', reduced: false };
          expect(moduleAccess(role, id, mode), `${role} / ${id} / ${mode}`).toEqual(want);
        }
      }
    },
  );

  it('Change Approver has no menu and no access outside private installs', () => {
    for (const mode of ['dedicated', 'shared'] as const) {
      expect(menuFor('change_approver', mode)).toEqual([]);
      for (const id of MODULE_IDS) {
        expect(moduleAccess('change_approver', id, mode), `${id} / ${mode}`).toEqual({ access: 'none', reduced: false });
      }
    }
  });

  it('menu items are the module definitions, with the group label keys', () => {
    const menu = menuFor('administrator', 'private');
    expect(menu.map((c) => c.console)).toEqual(['ops', 'admin']);
    const first = menu[0]?.groups[0];
    expect(first?.groupKey).toBe('nav.ops.group.live');
    expect(first?.items[0]?.id).toBe('ops.live_dispatch_board');
    expect(first?.items[0]?.menuKey).toBe('nav.ops.live_dispatch_board.menu');
  });

  it('returns fresh arrays, so a caller cannot change the next caller menu', () => {
    const a = menuFor('planner', 'private');
    a[0]?.groups.pop();
    a.pop();
    expect(menuFor('planner', 'private')).toHaveLength(1);
    expect(menuFor('planner', 'private')[0]?.groups).toHaveLength(3);
  });
});
