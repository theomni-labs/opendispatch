// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listUsers } from '@/lib/data/users';
import { actorNames } from './audit-actors';

// The real data layer against the committed fixtures, with the demo store in a temp folder so the developer's own
// .demo-state cannot change the result.
afterEach(() => {
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

describe('actorNames', () => {
  it('gives the display name of every actor of the events, once each', async () => {
    const admin = ctxOf('administrator');
    const events = (await listAuditEvents(admin, { limit: 50 })).items;
    const ids = new Set(events.flatMap((e) => (typeof e.actor_user_id === 'string' ? [e.actor_user_id] : [])));
    expect(ids.size).toBeGreaterThan(0);
    const names = await actorNames(admin, events);
    for (const id of ids) expect(typeof names[id]).toBe('string');
    expect(Object.keys(names).sort()).toEqual([...ids].sort());
  });

  it('works for the roles that may read the audit log but not list users (Viewer / Auditor, Change Approver)', async () => {
    const admin = ctxOf('administrator');
    const expected = await actorNames(admin, (await listAuditEvents(admin, { limit: 50 })).items);
    for (const role of ['viewer_auditor', 'change_approver'] as const) {
      const reader = ctxOf(role);
      await expect(listUsers(reader)).rejects.toThrow(ForbiddenError);
      expect(await actorNames(reader, (await listAuditEvents(reader, { limit: 50 })).items)).toEqual(expected);
    }
  });

  it('returns names only: no e-mail, role or zone', async () => {
    const admin = ctxOf('administrator');
    const names = await actorNames(admin, (await listAuditEvents(admin, { limit: 50 })).items);
    for (const value of Object.values(names)) expect(typeof value).toBe('string');
    expect(JSON.stringify(names)).not.toMatch(/@|administrator|dispatcher/);
  });

  it('asks nothing for events with no actor, and leaves out ids that match no user', async () => {
    const admin = ctxOf('administrator');
    expect(await actorNames(admin, [])).toEqual({});
    expect(await actorNames(admin, [{ actor_user_id: null }, {}, { actor_user_id: undefined }])).toEqual({});
    expect(await actorNames(admin, [{ actor_user_id: '00000000-0000-4000-8000-00000000dead' }])).toEqual({});
  });

  it('asks in chunks of 100, so a long list of events still resolves', async () => {
    const admin = ctxOf('administrator');
    const real = (await listAuditEvents(admin, { limit: 5 })).items.map((e) => e.actor_user_id).filter((id): id is string => typeof id === 'string');
    const fakes = Array.from({ length: 250 }, (_, i) => ({ actor_user_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    const names = await actorNames(admin, [...fakes, ...real.map((actor_user_id) => ({ actor_user_id }))]);
    expect(Object.keys(names).sort()).toEqual([...new Set(real)].sort());
  });
});
