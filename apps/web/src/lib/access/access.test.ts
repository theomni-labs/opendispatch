// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_KINDS,
  APPROVAL_MODULE,
  APPROVER_ROLES,
  INSTALL_MODES,
  MODULE_IDS,
  ROLES,
  approvalKindsFor,
  canApprove,
  canSeeConsole,
  checkApproval,
  defaultLanding,
  menuFor,
  moduleAccess,
  rolesForInstallMode,
  scopeAppliesTo,
  zoneAllowed,
  zoneScopeFor,
} from './index';
import type { ApprovalKind, Console, InstallMode, ModuleId, Role, ScopeKind, ZoneScope } from './index';

// Values that arrive as plain strings (a cookie, a form field) and skip the type checks.
const UNTRUSTED_ROLE = String('super_admin') as Role;
const UNTRUSTED_MODE = String('hosted') as InstallMode;
const UNTRUSTED_MODULE = String('ops.does_not_exist') as ModuleId;
const UNTRUSTED_KIND = String('delete_everything') as ApprovalKind;

describe('install modes and roles', () => {
  it('private has seven roles, in Appendix C order', () => {
    expect(rolesForInstallMode('private')).toEqual([
      'administrator',
      'dispatch_supervisor',
      'dispatcher',
      'planner',
      'remote_team_lead',
      'viewer_auditor',
      'change_approver',
    ]);
    expect(rolesForInstallMode('private')).toHaveLength(7);
  });

  it.each(['dedicated', 'shared'] as const)('%s has six roles and no Change Approver', (mode) => {
    const roles = rolesForInstallMode(mode);
    expect(roles).toHaveLength(6);
    expect(roles).not.toContain('change_approver');
    expect(roles).toEqual(['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor']);
  });

  it('returns a fresh array each time', () => {
    rolesForInstallMode('private').pop();
    expect(rolesForInstallMode('private')).toHaveLength(7);
  });

  it.each(['dedicated', 'shared'] as const)('%s: Change Approver gets nothing at all', (mode) => {
    expect(menuFor('change_approver', mode)).toEqual([]);
    expect(defaultLanding('change_approver', mode)).toBeNull();
    expect(approvalKindsFor('change_approver', mode)).toEqual([]);
    expect(canSeeConsole('change_approver', 'admin', mode)).toBe(false);
    expect(canSeeConsole('change_approver', 'ops', mode)).toBe(false);
    expect(
      canApprove({ role: 'change_approver', requesterUserId: 'u-admin', approverUserId: 'u-ca', kind: 'update', installMode: mode }),
    ).toBe(false);
  });
});

describe('Updates (plan 6.2 #16, STATUS.md decision 6)', () => {
  it.each(INSTALL_MODES)('%s: the Administrator has an Updates menu item', (mode) => {
    const items = menuFor('administrator', mode).flatMap((c) => c.groups.flatMap((g) => g.items));
    expect(items.map((m) => m.id)).toContain('admin.updates');
  });

  it('private: full screen, edit, not reduced', () => {
    expect(moduleAccess('administrator', 'admin.updates', 'private')).toEqual({ access: 'edit', reduced: false });
  });

  it.each(['dedicated', 'shared'] as const)('%s: same module id, view, reduced (version and release notes only)', (mode) => {
    expect(moduleAccess('administrator', 'admin.updates', mode)).toEqual({ access: 'view', reduced: true });
  });

  it('reduced is true for exactly one role, module and pair of modes, and nowhere else', () => {
    const reduced: string[] = [];
    for (const mode of INSTALL_MODES) {
      for (const role of ROLES) {
        for (const id of MODULE_IDS) {
          if (moduleAccess(role, id, mode).reduced) reduced.push(`${mode}/${role}/${id}`);
        }
      }
    }
    expect(reduced).toEqual(['dedicated/administrator/admin.updates', 'shared/administrator/admin.updates']);
  });

  it('Change Approver sees Updates only in a private install', () => {
    expect(moduleAccess('change_approver', 'admin.updates', 'private')).toEqual({ access: 'view', reduced: false });
    expect(moduleAccess('change_approver', 'admin.updates', 'dedicated').access).toBe('none');
    expect(moduleAccess('change_approver', 'admin.updates', 'shared').access).toBe('none');
  });

  it('no other role sees Updates in any mode', () => {
    for (const mode of INSTALL_MODES) {
      for (const role of ROLES) {
        if (role === 'administrator' || role === 'change_approver') continue;
        expect(moduleAccess(role, 'admin.updates', mode).access, `${role} / ${mode}`).toBe('none');
      }
    }
  });
});

describe('Sign-in and Identity Providers (plan 6.2 #2)', () => {
  it.each(['private', 'dedicated'] as const)('%s: the Administrator can edit', (mode) => {
    expect(moduleAccess('administrator', 'admin.sign_in_identity', mode)).toEqual({ access: 'edit', reduced: false });
  });

  it('shared: the Administrator gets it read-only, not reduced', () => {
    expect(moduleAccess('administrator', 'admin.sign_in_identity', 'shared')).toEqual({ access: 'view', reduced: false });
  });
});

describe('canSeeConsole', () => {
  const EXPECTED: Readonly<Record<Role, readonly [boolean, boolean]>> = {
    // [ops, admin]
    administrator: [true, true],
    dispatch_supervisor: [true, true],
    dispatcher: [true, false],
    planner: [true, false],
    remote_team_lead: [true, false],
    viewer_auditor: [true, true],
    change_approver: [false, true],
  };

  it.each(ROLES)('%s', (role) => {
    const [ops, admin] = EXPECTED[role];
    expect(canSeeConsole(role, 'ops')).toBe(ops);
    expect(canSeeConsole(role, 'admin')).toBe(admin);
    expect(canSeeConsole(role, 'ops', 'private')).toBe(ops);
    expect(canSeeConsole(role, 'admin', 'private')).toBe(admin);
  });

  it('agrees with the menu in every install mode', () => {
    for (const mode of INSTALL_MODES) {
      for (const role of ROLES) {
        for (const consoleId of ['ops', 'admin'] as const) {
          const inMenu = menuFor(role, mode).some((c) => c.console === consoleId);
          expect(canSeeConsole(role, consoleId, mode), `${role} / ${consoleId} / ${mode}`).toBe(inMenu);
        }
      }
    }
  });
});

describe('defaultLanding', () => {
  const EXPECTED_PRIVATE: Readonly<Record<Role, { console: Console; moduleId: ModuleId }>> = {
    administrator: { console: 'admin', moduleId: 'admin.users_roles' },
    dispatch_supervisor: { console: 'ops', moduleId: 'ops.live_dispatch_board' },
    dispatcher: { console: 'ops', moduleId: 'ops.live_dispatch_board' },
    planner: { console: 'ops', moduleId: 'ops.field_planner' },
    remote_team_lead: { console: 'ops', moduleId: 'ops.remote_queue' },
    viewer_auditor: { console: 'ops', moduleId: 'ops.live_dispatch_board' },
    change_approver: { console: 'admin', moduleId: 'admin.updates' },
  };

  it.each(ROLES)('%s lands where the default rule says, in a private install', (role) => {
    expect(defaultLanding(role, 'private')).toEqual(EXPECTED_PRIVATE[role]);
  });

  it('Dispatcher lands on Ops Live Dispatch Board; Change Approver on Admin Updates', () => {
    expect(defaultLanding('dispatcher', 'private')).toEqual({ console: 'ops', moduleId: 'ops.live_dispatch_board' });
    expect(defaultLanding('change_approver', 'private')).toEqual({ console: 'admin', moduleId: 'admin.updates' });
  });

  it.each(['dedicated', 'shared'] as const)('%s: the six roles land as in a private install', (mode) => {
    for (const role of rolesForInstallMode(mode)) {
      expect(defaultLanding(role, mode), role).toEqual(EXPECTED_PRIVATE[role]);
    }
  });

  it('always lands on an item that is in the role menu, and never on a module with access none', () => {
    for (const mode of INSTALL_MODES) {
      for (const role of ROLES) {
        const landing = defaultLanding(role, mode);
        const items = menuFor(role, mode).flatMap((c) => c.groups.flatMap((g) => g.items));
        if (items.length === 0) {
          expect(landing, `${role} / ${mode}`).toBeNull();
          continue;
        }
        expect(landing).not.toBeNull();
        if (landing === null) continue;
        expect(items.some((m) => m.id === landing.moduleId && m.console === landing.console)).toBe(true);
        expect(moduleAccess(role, landing.moduleId, mode).access).not.toBe('none');
      }
    }
  });

  it('a role that can only read lands on the first item of its menu', () => {
    const first = menuFor('viewer_auditor', 'private')[0]?.groups[0]?.items[0];
    expect(defaultLanding('viewer_auditor', 'private')?.moduleId).toBe(first?.id);
  });
});

describe('scope (Appendix C)', () => {
  const EXPECTED_KIND: Readonly<Record<Role, ScopeKind>> = {
    administrator: 'whole_install',
    dispatch_supervisor: 'assigned_zones',
    dispatcher: 'assigned_zones',
    planner: 'assigned_zones',
    remote_team_lead: 'remote_pool',
    viewer_auditor: 'whole_install',
    change_approver: 'whole_install',
  };

  it.each(ROLES)('%s scope kind', (role) => {
    expect(scopeAppliesTo(role)).toBe(EXPECTED_KIND[role]);
  });

  it('zoneScopeFor builds the scope kind the role has', () => {
    expect(zoneScopeFor('planner', ['z-1', 'z-2'])).toEqual({ kind: 'assigned_zones', zoneIds: ['z-1', 'z-2'] });
    expect(zoneScopeFor('administrator', ['z-1'])).toEqual({ kind: 'whole_install' });
    expect(zoneScopeFor('viewer_auditor', ['z-1'])).toEqual({ kind: 'whole_install' });
    expect(zoneScopeFor('change_approver')).toEqual({ kind: 'whole_install' });
    expect(zoneScopeFor('remote_team_lead', ['z-1'])).toEqual({ kind: 'remote_pool' });
    expect(zoneScopeFor('dispatcher')).toEqual({ kind: 'assigned_zones', zoneIds: [] });
  });

  it('zoneScopeFor copies the zone list', () => {
    const ids = ['z-1'];
    const scope = zoneScopeFor('dispatcher', ids);
    ids.push('z-2');
    expect(zoneAllowed(scope, 'z-2')).toBe(false);
  });

  it('an unknown role gets the narrowest scope: no zone', () => {
    const scope = zoneScopeFor(UNTRUSTED_ROLE, ['z-1']);
    expect(scope.kind).toBe('assigned_zones');
    expect(zoneAllowed(zoneScopeFor(UNTRUSTED_ROLE), 'z-1')).toBe(false);
  });

  describe('zoneAllowed', () => {
    const whole: ZoneScope = { kind: 'whole_install' };
    const zones: ZoneScope = { kind: 'assigned_zones', zoneIds: ['zone-riyadh-1', 'zone-riyadh-2'] };
    const none: ZoneScope = { kind: 'assigned_zones', zoneIds: [] };
    const pool: ZoneScope = { kind: 'remote_pool' };

    it('whole install reaches every zone', () => {
      expect(zoneAllowed(whole, 'zone-riyadh-1')).toBe(true);
      expect(zoneAllowed(whole, 'zone-jeddah-9')).toBe(true);
    });

    it('a zone list reaches exactly the listed zones', () => {
      expect(zoneAllowed(zones, 'zone-riyadh-1')).toBe(true);
      expect(zoneAllowed(zones, 'zone-riyadh-2')).toBe(true);
      expect(zoneAllowed(zones, 'zone-riyadh-3')).toBe(false);
      expect(zoneAllowed(zones, 'zone-jeddah-1')).toBe(false);
    });

    it('matches whole ids only: no prefix, no case folding, no blank', () => {
      expect(zoneAllowed(zones, 'zone-riyadh')).toBe(false);
      expect(zoneAllowed(zones, 'ZONE-RIYADH-1')).toBe(false);
      expect(zoneAllowed(zones, 'zone-riyadh-1 ')).toBe(false);
      expect(zoneAllowed(zones, '')).toBe(false);
    });

    it('an empty zone list reaches nothing', () => {
      expect(zoneAllowed(none, 'zone-riyadh-1')).toBe(false);
      expect(zoneAllowed(none, '')).toBe(false);
    });

    it('the remote pool is not a zone: it reaches no zone id', () => {
      expect(zoneAllowed(pool, 'zone-riyadh-1')).toBe(false);
    });

    it('a malformed scope reaches nothing', () => {
      const bad = { kind: 'everything' } as unknown as ZoneScope;
      expect(zoneAllowed(bad, 'zone-riyadh-1')).toBe(false);
    });
  });
});

describe('approvals', () => {
  // Who may approve what, typed out from the role matrix and (flows 1, 2, 3) and 9.6.
  // [kind, roles that may approve]. The leave row is an assumption (README): no approver is specified.
  const WHO_MAY_APPROVE: ReadonlyArray<readonly [ApprovalKind, readonly Role[]]> = [
    ['rule', ['dispatch_supervisor']], // flow 1: Administrator drafts, a Dispatch Supervisor approves
    ['roster_override', ['dispatch_supervisor']], // flow 2 and "approve overrides"
    ['leave', ['planner']], // assumption
    ['update', ['change_approver']], // 9.6: approvers hold the Change Approver role
  ];

  it('covers exactly the four kinds', () => {
    expect([...APPROVAL_KINDS]).toEqual(WHO_MAY_APPROVE.map(([kind]) => kind));
  });

  it.each(WHO_MAY_APPROVE)('%s: only the named roles may approve, someone else requested', (kind, allowedRoles) => {
    for (const role of ROLES) {
      const decision = checkApproval({ role, requesterUserId: 'u-requester', approverUserId: 'u-approver', kind });
      if (allowedRoles.includes(role)) {
        expect(decision, `${role} / ${kind}`).toEqual({ allowed: true });
        expect(canApprove({ role, requesterUserId: 'u-requester', approverUserId: 'u-approver', kind })).toBe(true);
      } else {
        expect(decision, `${role} / ${kind}`).toEqual({ allowed: false, reason: 'role_cannot_approve_kind' });
        expect(canApprove({ role, requesterUserId: 'u-requester', approverUserId: 'u-approver', kind })).toBe(false);
      }
    }
  });

  it('nobody approves their own request, for any role and any kind', () => {
    for (const role of ROLES) {
      for (const kind of APPROVAL_KINDS) {
        expect(canApprove({ role, requesterUserId: 'u-1', approverUserId: 'u-1', kind }), `${role} / ${kind}`).toBe(false);
      }
    }
  });

  it('reports why: an approver who is also the requester is refused as own_request', () => {
    expect(checkApproval({ role: 'dispatch_supervisor', requesterUserId: 'u-7', approverUserId: 'u-7', kind: 'roster_override' })).toEqual({
      allowed: false,
      reason: 'own_request',
    });
    expect(checkApproval({ role: 'planner', requesterUserId: 'u-7', approverUserId: 'u-7', kind: 'leave' })).toEqual({
      allowed: false,
      reason: 'own_request',
    });
    expect(checkApproval({ role: 'change_approver', requesterUserId: 'u-7', approverUserId: 'u-7', kind: 'update' })).toEqual({
      allowed: false,
      reason: 'own_request',
    });
  });

  it('a supervisor can approve another person roster but not their own', () => {
    const base = { role: 'dispatch_supervisor', kind: 'roster_override' } as const;
    expect(canApprove({ ...base, requesterUserId: 'planner-1', approverUserId: 'supervisor-1' })).toBe(true);
    expect(canApprove({ ...base, requesterUserId: 'supervisor-1', approverUserId: 'supervisor-1' })).toBe(false);
    expect(canApprove({ ...base, requesterUserId: 'supervisor-1', approverUserId: 'supervisor-2' })).toBe(true);
  });

  it('the Administrator drafts rules and cannot approve them; the Viewer / Auditor approves nothing', () => {
    for (const kind of APPROVAL_KINDS) {
      expect(canApprove({ role: 'administrator', requesterUserId: 'a', approverUserId: 'b', kind }), kind).toBe(false);
      expect(canApprove({ role: 'viewer_auditor', requesterUserId: 'a', approverUserId: 'b', kind }), kind).toBe(false);
      expect(canApprove({ role: 'dispatcher', requesterUserId: 'a', approverUserId: 'b', kind }), kind).toBe(false);
      expect(canApprove({ role: 'remote_team_lead', requesterUserId: 'a', approverUserId: 'b', kind }), kind).toBe(false);
    }
  });

  it('with an install mode given, update approval works in private and is refused elsewhere', () => {
    const base = { role: 'change_approver', requesterUserId: 'admin-1', approverUserId: 'ca-1', kind: 'update' } as const;
    expect(checkApproval({ ...base, installMode: 'private' })).toEqual({ allowed: true });
    expect(checkApproval({ ...base, installMode: 'dedicated' })).toEqual({ allowed: false, reason: 'role_not_in_install_mode' });
    expect(checkApproval({ ...base, installMode: 'shared' })).toEqual({ allowed: false, reason: 'role_not_in_install_mode' });
  });

  it('other kinds are unaffected by the install mode', () => {
    for (const mode of INSTALL_MODES) {
      expect(canApprove({ role: 'dispatch_supervisor', requesterUserId: 'a', approverUserId: 'b', kind: 'rule', installMode: mode })).toBe(true);
    }
  });

  it('fails closed on unknown values and blank ids', () => {
    const ok = { role: 'dispatch_supervisor', requesterUserId: 'a', approverUserId: 'b', kind: 'rule' } as const;
    expect(checkApproval({ ...ok, role: UNTRUSTED_ROLE })).toEqual({ allowed: false, reason: 'invalid_input' });
    expect(checkApproval({ ...ok, kind: UNTRUSTED_KIND })).toEqual({ allowed: false, reason: 'invalid_input' });
    expect(checkApproval({ ...ok, installMode: UNTRUSTED_MODE })).toEqual({ allowed: false, reason: 'invalid_input' });
    expect(checkApproval({ ...ok, requesterUserId: '' })).toEqual({ allowed: false, reason: 'invalid_input' });
    expect(checkApproval({ ...ok, approverUserId: '' })).toEqual({ allowed: false, reason: 'invalid_input' });
    expect(checkApproval({ ...ok, requesterUserId: '', approverUserId: '' }).allowed).toBe(false);
  });

  it('approvalKindsFor lists what the shell may show Approve and Reject for', () => {
    expect(approvalKindsFor('dispatch_supervisor', 'private')).toEqual(['rule', 'roster_override']);
    expect(approvalKindsFor('planner', 'private')).toEqual(['leave']);
    expect(approvalKindsFor('change_approver', 'private')).toEqual(['update']);
    for (const role of ['administrator', 'dispatcher', 'remote_team_lead', 'viewer_auditor'] as const) {
      expect(approvalKindsFor(role, 'private'), role).toEqual([]);
    }
    expect(approvalKindsFor('dispatch_supervisor', 'shared')).toEqual(['rule', 'roster_override']);
  });

  it('every approver can see the module the approval is done in, in a private install', () => {
    for (const kind of APPROVAL_KINDS) {
      for (const role of APPROVER_ROLES[kind]) {
        expect(moduleAccess(role, APPROVAL_MODULE[kind], 'private').access, `${role} / ${kind}`).not.toBe('none');
      }
    }
  });

  it('the Supervisor cannot draft rules and the Change Approver cannot apply updates: approve is not edit', () => {
    expect(moduleAccess('dispatch_supervisor', 'admin.classification_rules', 'private').access).toBe('view');
    expect(moduleAccess('change_approver', 'admin.updates', 'private').access).toBe('view');
  });
});

describe('fail closed on unknown input', () => {
  it('an unknown role has no access, no menu, no landing, no console', () => {
    for (const mode of INSTALL_MODES) {
      expect(menuFor(UNTRUSTED_ROLE, mode)).toEqual([]);
      expect(defaultLanding(UNTRUSTED_ROLE, mode)).toBeNull();
      expect(approvalKindsFor(UNTRUSTED_ROLE, mode)).toEqual([]);
      for (const id of MODULE_IDS) {
        expect(moduleAccess(UNTRUSTED_ROLE, id, mode)).toEqual({ access: 'none', reduced: false });
      }
    }
    expect(canSeeConsole(UNTRUSTED_ROLE, 'ops')).toBe(false);
    expect(canSeeConsole(UNTRUSTED_ROLE, 'admin')).toBe(false);
  });

  it('an unknown install mode has no roles, no menu and no access', () => {
    expect(rolesForInstallMode(UNTRUSTED_MODE)).toEqual([]);
    for (const role of ROLES) {
      expect(menuFor(role, UNTRUSTED_MODE), role).toEqual([]);
      expect(defaultLanding(role, UNTRUSTED_MODE), role).toBeNull();
    }
  });

  it('an unknown module id has no access', () => {
    for (const role of ROLES) {
      expect(moduleAccess(role, UNTRUSTED_MODULE, 'private')).toEqual({ access: 'none', reduced: false });
    }
  });

  it('an unknown console is not visible', () => {
    const untrusted = String('operator') as Console;
    for (const role of ROLES) {
      expect(canSeeConsole(role, untrusted)).toBe(false);
    }
  });
});
