// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listRoleMappings } from '@/lib/data/identity';
import { listZones } from '@/lib/data/locations';
import { previewRules, saveRule } from './actions';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Zones is api-backed: saveRule and previewRules both
// need live zone lookups.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

// The server actions against the real data layer and the committed fixtures, with the demo store in a temp folder. The session is
// the only thing stood in for: requireRequestContext returns the context of the role and install mode the test picks.
const session = vi.hoisted(() => ({ role: 'administrator' as string | null, mode: 'private' as string, revalidate: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: session.revalidate }));
vi.mock('@/lib/data/context', async (original) => {
  const real = await original<typeof import('@/lib/data/context')>();
  return {
    ...real,
    requireRequestContext: async () => {
      if (session.role === null) throw new UnauthenticatedError();
      return contextOf(session.role as Role, session.mode as InstallMode);
    },
  };
});

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}


beforeEach(async () => {
  await resetGoTestState();
  session.role = 'administrator';
  session.mode = 'private';
  session.revalidate.mockReset();
});

// Reading uses an administrator context whatever the session says, so a test can look at what a call left behind.
async function adminContext(mode: InstallMode = 'private'): Promise<RequestContext> {
  return contextOf('administrator', mode);
}
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;
const rules = async () => (await listRoleMappings(await adminContext(), { limit: 200 })).items;
const zoneIds = async (n: number) => (await listZones(await adminContext())).items.slice(0, n).map((z) => z.id);

describe.skipIf(!hasApi)('group rules (live, real api and Postgres)', () => {
  const rule = async (change: Record<string, unknown> = {}) => ({ group_match: 'opendispatch-new-group', group_match_type: 'exact', assigned_role: 'planner', zone_ids: await zoneIds(2), priority: 20, ...change });

  it('adds a rule with its zones, audits it, and puts it in order', async () => {
    const result = await saveRule((await rule()) as never);
    expect(result).toMatchObject({ ok: true, data: { match: 'opendispatch-new-group' } });
    const added = (await rules()).find((r) => r.group_match === 'opendispatch-new-group');
    expect(added).toMatchObject({ assigned_role: 'planner', priority: 20, is_enabled: true, identity_provider_id: null });
    expect(added?.zone_ids).toHaveLength(2);
    expect((await events('role_mapping.created')).at(0)).toMatchObject({ outcome: 'success' });
  });

  it('changes a rule and keeps whether it is on and the provider it is tied to', async () => {
    const target = (await rules()).find((r) => r.is_enabled === false) as NonNullable<Awaited<ReturnType<typeof rules>>[number]>;
    const result = await saveRule({ ...(await rule({ group_match: 'opendispatch-renamed' })), ruleId: target.id } as never);
    expect(result).toMatchObject({ ok: true, data: { id: target.id, match: 'opendispatch-renamed' } });
    expect((await rules()).find((r) => r.id === target.id)).toMatchObject({ group_match: 'opendispatch-renamed', is_enabled: false, identity_provider_id: target.identity_provider_id ?? null });
  });

  it.each([
    ['an object ID that is not a GUID', { group_match_type: 'object_id', group_match: 'not-a-guid' }],
    ['a role with zones and no zone', { zone_ids: [] }],
    ['a role that does not exist', { assigned_role: 'root' }],
    ['a match type that does not exist', { group_match_type: 'regex' }],
    ['an empty group', { group_match: '' }],
    ['a zone that does not exist', { zone_ids: ['00000000-0000-4000-8000-00000000dead'] }],
  ])('refuses %s, as `invalid`, and adds nothing', async (_name, change) => {
    const before = (await rules()).length;
    expect(await saveRule((await rule(change)) as never)).toMatchObject({ ok: false, code: 'invalid' });
    expect((await rules()).length).toBe(before);
  });

  it('refuses Change Approver in a shared install (the role does not exist there)', async () => {
    session.mode = 'shared';
    // the Administrator only reads in a shared install, so this is refused before the role is looked at
    expect(await saveRule((await rule({ assigned_role: 'change_approver', zone_ids: [] })) as never)).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe.skipIf(!hasApi)('previewRules (a read, live, real api and Postgres)', () => {
  it('answers the role and zones a list of groups gets, with the rules that matched, and writes nothing', async () => {
    const before = (await listAuditEvents(await adminContext(), { limit: 1 })).page.total;
    const result = await previewRules({ groups: ['opendispatch-dispatch-riyadh-core'] });
    expect(result).toMatchObject({ ok: true, data: { role: 'dispatcher', zoneCodes: ['RD-C', 'RD-N'] } });
    if (result.ok) expect(result.data.matchedIds).toHaveLength(1);
    expect((await listAuditEvents(await adminContext(), { limit: 1 })).page.total).toBe(before);
    expect(session.revalidate).not.toHaveBeenCalled();
  });

  it('gives no role for a group no rule matches', async () => {
    expect(await previewRules({ groups: ['unknown-group'] })).toMatchObject({ ok: true, data: { role: null, zoneCodes: [], matchedIds: [] } });
    expect(await previewRules({ groups: [] })).toMatchObject({ ok: true, data: { role: null } });
  });

  it('is open to the Administrator in a shared install (view is enough) and refused for a role with no access', async () => {
    session.mode = 'shared';
    expect(await previewRules({ groups: ['opendispatch-auditors'] })).toMatchObject({ ok: true, data: { role: 'viewer_auditor' } });
    session.mode = 'private';
    session.role = 'planner';
    expect(await previewRules({ groups: ['opendispatch-auditors'] })).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('refuses input that is not a list of at most 50 short strings', async () => {
    for (const bad of [null, undefined, 'a', 42, [1], Array.from({ length: 51 }, (_, i) => `g${i}`), ['x'.repeat(300)]]) expect(await previewRules({ groups: bad as never }), JSON.stringify(bad)?.slice(0, 20)).toMatchObject({ ok: false, code: 'invalid' });
  });
});
