// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { buildRoster, listRosterAssignments } from '@/lib/data/rosters';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { generateBreakPlanAction, updateBreakSlotAction } from './actions';
import { freshDate } from '../../../../test/live-fixtures';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Both actions is api-backed now (rosters.ts/breaks.ts).
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

const RD_C = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';

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

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [RD_C] }, fixtureUsers(), tenant);
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

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  session.role = 'planner';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetGoTestState();
});
afterEach(() => {
  errorLog.mockRestore();
});

async function ctx(role: Role = 'planner'): Promise<RequestContext> {
  return contextOf(role, 'private');
}

const events = async (action: string) => (await listAuditEvents(await ctx('administrator'), { action, limit: 200 })).items;

describe.skipIf(!hasApi)('updateBreakSlotAction (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

  // Day A (00139b83-...): 06:00-14:00, BRK-STD
  // (30 min after 5 h): a break may start 11:00
  // to 13:30; 11:15 is always inside it. Shift
  // patterns are date-independent fixture data.
  const DAY_A = 'bfd12e32-9711-49d5-a7a6-a1653fd12607';

  it('moves one break inside its allowed window, audits it and revalidates', async () => {
    const date = freshDate(2);
    const built = await buildRoster(await ctx(), { zone_id: RD_C, roster_date: date });
    const assignment = (await listRosterAssignments(await ctx(), built.id, { limit: 200 })).items.find((a) => a.shift_pattern_id === DAY_A)!;
    const result = await updateBreakSlotAction({ rosterAssignmentId: assignment.id, date, startMin: 675 });
    expect(result).toMatchObject({ ok: true, data: { roster_assignment_id: assignment.id, start_at: `${date}T11:15:00+03:00` } });
    expect((await events('break.slot_moved')).at(0)).toMatchObject({ outcome: 'success' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/ops/break-planner', '/ar/ops/break-planner']);
  });

  it('refuses an invalid start time and an unknown assignment', async () => {
    const date = freshDate(2);
    expect(await updateBreakSlotAction({ rosterAssignmentId: 'x', date, startMin: Number.NaN })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await updateBreakSlotAction({ rosterAssignmentId: '00000000-0000-0000-0000-000000000000', date, startMin: 90 })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('is refused for a role with no access to Break Planner', async () => {
    const date = freshDate(2);
    const built = await buildRoster(await ctx(), { zone_id: RD_C, roster_date: date });
    const assignment = (await listRosterAssignments(await ctx(), built.id, { limit: 1 })).items[0]!;
    session.role = 'dispatcher';
    expect(await updateBreakSlotAction({ rosterAssignmentId: assignment.id, date, startMin: 90 })).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe.skipIf(!hasApi)('generateBreakPlanAction (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

  it('generates the day’s plan, audits it and revalidates the route', async () => {
    const date = freshDate(2);
    await buildRoster(await ctx(), { zone_id: RD_C, roster_date: date });
    const result = await generateBreakPlanAction({ zoneId: RD_C, date });
    expect(result).toMatchObject({ ok: true, data: { zone_id: RD_C, roster_date: date } });
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.slots.length).toBeGreaterThan(0);
    expect((await events('break.plan_generated')).at(0)).toMatchObject({ outcome: 'success' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/ops/break-planner', '/ar/ops/break-planner']);
  });

  it('refuses a missing zone or day (invalid) and a roster that does not exist (not found)', async () => {
    const date = freshDate(2);
    expect(await generateBreakPlanAction({ zoneId: '', date })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await generateBreakPlanAction({ zoneId: RD_C, date: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await generateBreakPlanAction({ zoneId: RD_C, date: freshDate(2) })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('is refused for a role with no access to Break Planner', async () => {
    const date = freshDate(2);
    await buildRoster(await ctx(), { zone_id: RD_C, roster_date: date });
    session.role = 'dispatcher';
    expect(await generateBreakPlanAction({ zoneId: RD_C, date })).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

// Neither check below reaches the api: no hasApi gate needed.
describe('every action', () => {
  it('answers `unauthenticated` with no session, and leaks no input on an unexpected error', async () => {
    session.role = null;
    expect(await generateBreakPlanAction({ zoneId: RD_C, date: freshDate(2) })).toMatchObject({ ok: false, code: 'unauthenticated' });
    session.role = 'planner';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2');
        },
      },
    );
    const result = await generateBreakPlanAction(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result) + errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|boom/);
  });
});
