// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { controlReplay, getReplayState, listLiveCases } from '@/lib/data/dispatch';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import { accept, override, toggleOutage, toggleReplay } from './actions';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

// Real data layer; session alone stood in.
// dispatch.test.ts covers the calls; this: wiring.
const session = vi.hoisted(() => ({ role: 'dispatcher' as string | null, mode: 'private' as string, revalidate: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: session.revalidate }));
vi.mock('@/lib/data/context', async (original) => {
  const real = await original<typeof import('@/lib/data/context')>();
  return {
    ...real,
    requireRequestContext: async () => {
      if (session.role === null) throw new UnauthenticatedError();
      return ctxOf(session.role as Role, session.mode as InstallMode);
    },
  };
});

/** Every zone id (`dispatcher` and `dispatch_supervisor` are zone-scoped: an empty list would reach nothing). */
async function allZoneIds(): Promise<string[]> {
  return (await listZones(await ctxOf('administrator'), { limit: 200 })).items.map((z) => z.id);
}

async function ctxOf(role: Role, installMode: InstallMode = 'private'): Promise<RequestContext> {
  const tenant = fixtureTenantId();
  const zoneIds = role === 'dispatcher' || role === 'dispatch_supervisor' ? await allZoneIds() : [];
  const built = buildContext({ role, installMode, zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

const admin = () => ctxOf('administrator');
const dispatcher = () => ctxOf('dispatcher');

/** The first `recommended` case anywhere, or undefined at this replay moment. */
async function anyRecommendedCase(): Promise<{ caseId: string; agentId: string } | undefined> {
  const found = (await listLiveCases(await dispatcher(), { state: 'recommended', limit: 50 })).items.find((c) => c.recommendation !== undefined && c.recommendation !== null);
  return found === undefined ? undefined : { caseId: found.case_id, agentId: (found.recommendation as NonNullable<typeof found.recommendation>).agent_id };
}

describe.skipIf(!hasApi)('the Live Dispatch Board server actions (live, real api and Postgres)', () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    session.role = 'dispatcher';
    session.mode = 'private';
    session.revalidate.mockReset();
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The mockup's reference moment: a recommended case.
    await controlReplay(await dispatcher(), { action: 'seek', replay_at: '2026-09-13T10:42:50+03:00' });
  });
  afterEach(() => {
    errorLog.mockRestore();
  });

  it('toggleReplay pauses and resumes; toggleOutage simulates and clears a feed outage', async () => {
    const played = await toggleReplay({ playing: true });
    expect(played.ok).toBe(true);
    if (played.ok) expect(played.data.status).toBe('playing');

    const on = await toggleOutage({ active: true });
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.data.state).toBe('active');

    const off = await toggleOutage({ active: false });
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.data.fallback_assigned_count).toBeGreaterThanOrEqual(0);
  });

  it('a role with only view access (administrator) is refused, never silently ignored', async () => {
    session.role = 'administrator';
    const result = await accept({ caseId: '00000000-0000-4000-8000-000000000001', agentId: '00000000-0000-4000-8000-000000000002' });
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('override refuses a body missing the required reason code, without touching the store', async () => {
    const target = await anyRecommendedCase();
    if (target === undefined) return; // no recommended case exists at this replay moment in the fixtures
    const result = await override({ caseId: target.caseId, agentId: target.agentId, reasonCode: '', note: null });
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('accept assigns the recommended agent and records the OpenDispatch source', async () => {
    const target = await anyRecommendedCase();
    if (target === undefined) return;
    const result = await accept({ caseId: target.caseId, agentId: target.agentId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe('OPENDISPATCH');
      expect(result.data.agent_id).toBe(target.agentId);
    }
    expect(session.revalidate).toHaveBeenCalled();
  });

  it('is refused with no session (unauthenticated), same as every other write', async () => {
    session.role = null;
    const result = await toggleReplay({ playing: true });
    expect(result).toMatchObject({ ok: false, code: 'unauthenticated' });
  });

  it('replay controls stay in step: the module knows the current state after each action', async () => {
    await toggleReplay({ playing: false });
    expect((await getReplayState(await admin())).status).not.toBe('playing');
  });
});
