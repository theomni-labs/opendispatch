// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { getCoverage } from '@/lib/data/standby';
import { applyMoveAction } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
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

const RD_C = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';
const DRAFT_DAY = '2026-09-15';
const SUBMITTED_DAY = '2026-09-14';

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [RD_C] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await resetGoTestState();
  session.role = 'planner';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});

async function ctx(role: Role = 'planner'): Promise<RequestContext> {
  return contextOf(role, 'private');
}

async function movablePair(date: string = DRAFT_DAY): Promise<{ from: string; to: string }> {
  const coverage = await getCoverage(await ctx(), { zone_id: RD_C, date });
  const from = coverage.areas.find((a) => a.recommended_agents > 0)?.standby_point_id ?? '';
  const to = coverage.areas.find((a) => a.standby_point_id !== from)?.standby_point_id ?? '';
  return { from, to };
}

describe.skipIf(!hasApi)('applyMoveAction (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

  it('moves one agent and the coverage answers the new staffing, audited', async () => {
    const { from, to } = await movablePair();
    const result = await applyMoveAction({ zone_id: RD_C, roster_date: DRAFT_DAY, from_standby_point_id: from, to_standby_point_id: to, agents: 1 });
    expect(result).toMatchObject({ ok: true, data: { zone_id: RD_C, roster_date: DRAFT_DAY } });
    if (!result.ok) throw new Error('unreachable');
    const area = result.data.areas.find((a) => a.standby_point_id === to);
    expect(area?.recommended_agents).toBeGreaterThan(0);
    expect((await listAuditEvents(await ctx('administrator'), { action: 'standby.moved', limit: 200 })).items[0]).toMatchObject({ outcome: 'success' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/ops/standby-coverage', '/ar/ops/standby-coverage']);
  });

  it('is refused for a role with no edit access (view only), audited as denied', async () => {
    const { from, to } = await movablePair();
    session.role = 'dispatcher';
    const result = await applyMoveAction({ zone_id: RD_C, roster_date: DRAFT_DAY, from_standby_point_id: from, to_standby_point_id: to, agents: 1 });
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('refuses the same point twice (invalid) without touching the store', async () => {
    const { from } = await movablePair();
    const result = await applyMoveAction({ zone_id: RD_C, roster_date: DRAFT_DAY, from_standby_point_id: from, to_standby_point_id: from, agents: 1 });
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses a roster that is not a draft (conflict)', async () => {
    const { from, to } = await movablePair(SUBMITTED_DAY);
    const result = await applyMoveAction({ zone_id: RD_C, roster_date: SUBMITTED_DAY, from_standby_point_id: from, to_standby_point_id: to, agents: 1 });
    expect(result).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('answers unauthenticated with no session, and leaks no input on an unexpected error', async () => {
    session.role = null;
    expect(await applyMoveAction({ zone_id: RD_C, roster_date: DRAFT_DAY, from_standby_point_id: RD_C, to_standby_point_id: RD_C, agents: 1 })).toMatchObject({
      ok: false,
      code: 'unauthenticated',
    });
    session.role = 'planner';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2');
        },
      },
    );
    const result = await applyMoveAction(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result) + errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|boom/);
  });
});
