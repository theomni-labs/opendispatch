// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listRosters } from '@/lib/data/rosters';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { runSimulationAction } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// runSimulationAction reads the live roster
// before its own checks: see actions.test.ts for
// the tests that never reach that lookup.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

const session = vi.hoisted(() => ({ role: 'planner' as string | null, mode: 'private' as string, revalidate: vi.fn() }));

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

// The seeded Planner's own zones (Riyadh Central,
// North, East): an "assigned_zones" role needs a
// real zone list, unlike Remote Team Lead's own
// "remote_pool" scope (which ignores it).
const PLANNER_ZONES = ['091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a', 'eecf5c7f-237c-443c-b331-b75ba3fb26fc', '555117e3-96d2-43fc-9fb1-45ec4ed1d8ad'];

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const tenant = fixtureTenantId();
  const zoneIds = role === 'planner' || role === 'dispatch_supervisor' || role === 'dispatcher' ? PLANNER_ZONES : [];
  const built = buildContext({ role, installMode, zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

// Screens may not import lib/data/internal (opendispatch/no-banned-import), so this
// mirrors lib/data/test-support.ts's resetGoTestState() locally.
async function resetGoTestState(): Promise<void> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') return;
  try {
    await fetch(`${url}/_internal/test/reset`, { method: 'POST' });
  } catch {
    // best-effort
  }
}

beforeEach(async () => {
  session.role = 'planner';
  session.mode = 'private';
  session.revalidate.mockReset();
  await resetGoTestState();
});

async function ctx(role: Role = 'planner'): Promise<RequestContext> {
  return contextOf(role, 'private');
}

const events = async (action: string) => (await listAuditEvents(await ctx('administrator'), { action, limit: 200 })).items;

describe.skipIf(!hasApi)('runSimulationAction (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

  it('runs a simulation against a real roster, audits it and revalidates the route', async () => {
    const roster = (await listRosters(await ctx(), { limit: 200 })).items[0]!;
    const result = await runSimulationAction({ rosterId: roster.id, runDate: '2026-09-12', policy: 'scorer' });
    expect(result).toMatchObject({ ok: true, data: { roster_id: roster.id, run_date: '2026-09-12', assignment_policy: 'scorer', status: 'succeeded' } });
    expect(result.ok && result.data.zones_replayed).toBeGreaterThan(0);
    expect((await events('simulation.run')).at(0)).toMatchObject({ outcome: 'success' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/ops/service-level-simulator', '/ar/ops/service-level-simulator']);
  });

  it('refuses a day with no case history (invalid) and an unknown roster (not found)', async () => {
    const roster = (await listRosters(await ctx(), { limit: 200 })).items[0]!;
    expect(await runSimulationAction({ rosterId: roster.id, runDate: '2020-01-01', policy: 'nearest' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await runSimulationAction({ rosterId: '00000000-0000-0000-0000-000000000000', runDate: '2026-09-12', policy: 'nearest' })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('is refused for a role with no edit access to the simulator', async () => {
    const roster = (await listRosters(await ctx(), { limit: 200 })).items[0]!;
    session.role = 'viewer_auditor';
    expect(await runSimulationAction({ rosterId: roster.id, runDate: '2026-09-12', policy: 'nearest' })).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('refuses an empty roster or day up front (invalid, no data-layer call)', async () => {
    expect(await runSimulationAction({ rosterId: '', runDate: '2026-09-12', policy: 'nearest' })).toMatchObject({ ok: false, code: 'invalid' });
    const roster = (await listRosters(await ctx(), { limit: 200 })).items[0]!;
    expect(await runSimulationAction({ rosterId: roster.id, runDate: '', policy: 'nearest' })).toMatchObject({ ok: false, code: 'invalid' });
  });
});
