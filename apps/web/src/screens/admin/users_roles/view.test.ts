// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import type { InstallMode, Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { loadUsersView, summarise, zoneCode } from './view';

// The server side of the screen against the real data layer and the committed fixtures (13 people, 8 zones, 3 cities).
beforeEach(async () => {
  await resetGoTestState();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

// loadUsersView always needs live zones: other
// tests moved to view.live.test.ts.
describe('loadUsersView: the list', () => {
  it('is for roles with access to the module only: the data layer refuses the others', async () => {
    for (const role of ['viewer_auditor', 'planner', 'dispatcher'] as const) await expect(loadUsersView(ctxOf(role), {})).rejects.toThrow(ForbiddenError);
  });
});

describe('summarise and zoneCode', () => {
  it('groups modules by level, turns can_approve into the approval kind, and ignores an id it does not know', () => {
    expect(
      summarise([
        { module_id: 'admin.users_roles', access: 'edit', can_approve: false },
        { module_id: 'admin.classification_rules', access: 'view', can_approve: true },
        { module_id: 'ops.leave_planner', access: 'view', can_approve: true },
        { module_id: 'ops.gap_surplus', access: 'none', can_approve: false },
        { module_id: 'not.a_module', access: 'edit', can_approve: false },
      ]),
    ).toEqual({ edit: ['admin.users_roles'], view: ['admin.classification_rules', 'ops.leave_planner'], approve: ['rule', 'leave'], hidden: 1 });
  });

  it('reads the short code of a zone from its extra data, else its name', () => {
    const base = { id: 'z', tenant_id: 't', created_at: '', updated_at: '', created_by: null, data_source: 'SYNTHETIC', external_id: null, city_id: 'c', is_active: true, name_ar: null } as const;
    expect(zoneCode({ ...base, name_en: 'Riyadh Central', extra: { code: 'RD-C' } })).toBe('RD-C');
    expect(zoneCode({ ...base, name_en: 'Riyadh Central', extra: {} })).toBe('Riyadh Central');
    expect(zoneCode({ ...base, name_en: 'Riyadh Central', extra: { code: '' } })).toBe('Riyadh Central');
  });
});
