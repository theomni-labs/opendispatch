// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from './errors';
import { canAccess, canReadZone, canWriteZone, requireAccess, type RequestContext } from './guard';

const base = { customerId: 'cust', userId: 'user', installMode: 'private' } as const;

const planner: RequestContext = { ...base, role: 'planner', zoneScope: { kind: 'assigned_zones', zoneIds: ['z1', 'z2'] } };
const admin: RequestContext = { ...base, role: 'administrator', zoneScope: { kind: 'whole_install' } };
const remoteLead: RequestContext = { ...base, role: 'remote_team_lead', zoneScope: { kind: 'remote_pool' } };
const dispatcher: RequestContext = { ...base, role: 'dispatcher', zoneScope: { kind: 'assigned_zones', zoneIds: ['z1'] } };

describe('module access in the data layer', () => {
  it('lets a planner edit the field planner and only view the live board', () => {
    expect(canAccess(planner, 'ops.field_planner', 'edit')).toBe(true);
    expect(canAccess(planner, 'ops.live_dispatch_board', 'view')).toBe(true);
    expect(canAccess(planner, 'ops.live_dispatch_board', 'edit')).toBe(false);
  });

  it('keeps a dispatcher out of the Admin Console', () => {
    expect(canAccess(dispatcher, 'admin.users_roles', 'view')).toBe(false);
    expect(() => requireAccess(dispatcher, 'admin.users_roles', 'view')).toThrow(ForbiddenError);
  });

  it('honours the install mode: Change Approver does not exist outside private', () => {
    const changeApprover: RequestContext = { ...base, role: 'change_approver', zoneScope: { kind: 'whole_install' } };
    expect(canAccess(changeApprover, 'admin.updates', 'view')).toBe(true);
    expect(canAccess({ ...changeApprover, installMode: 'shared' }, 'admin.updates', 'view')).toBe(false);
  });
});

describe('zone scope', () => {
  it('reads and writes only assigned zones', () => {
    expect(canReadZone(planner, 'z1')).toBe(true);
    expect(canReadZone(planner, 'z9')).toBe(false);
    expect(canReadZone(planner, null)).toBe(false);
    expect(canWriteZone(planner, 'z2')).toBe(true);
    expect(canWriteZone(planner, 'z9')).toBe(false);
  });

  it('lets the whole-install role do both everywhere', () => {
    expect(canReadZone(admin, 'z9')).toBe(true);
    expect(canWriteZone(admin, 'z9')).toBe(true);
    expect(canReadZone(admin, null)).toBe(true);
  });

  it('lets the remote pool read across zones but not write zone records', () => {
    expect(canReadZone(remoteLead, 'z9')).toBe(true);
    expect(canWriteZone(remoteLead, 'z9')).toBe(false);
  });

  it('gives an empty zone list no reach', () => {
    const nobody: RequestContext = { ...planner, zoneScope: { kind: 'assigned_zones', zoneIds: [] } };
    expect(canReadZone(nobody, 'z1')).toBe(false);
    expect(canWriteZone(nobody, 'z1')).toBe(false);
  });
});
