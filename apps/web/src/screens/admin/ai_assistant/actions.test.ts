// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { getAssistantOverview } from '@/lib/data/assistant';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { buildContext, fixtureTenantId, fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { testConnection } from './actions';

// Real Go api; the session is stood in for.
const session = vi.hoisted(() => ({ role: 'administrator' as string | null, revalidate: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: session.revalidate }));
vi.mock('@/lib/data/context', async (original) => {
  const real = await original<typeof import('@/lib/data/context')>();
  return {
    ...real,
    requireRequestContext: async () => {
      if (session.role === null) throw new UnauthenticatedError();
      return contextOf(session.role as Role, 'private');
    },
  };
});

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), fixtureTenantId());
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await resetGoTestState();
  session.role = 'administrator';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorLog.mockRestore());

const events = async () => (await listAuditEvents(contextOf('administrator', 'private'), { action: 'assistant.test', limit: 50 })).items;

describe('getAssistantOverview', () => {
  it('reads for the Administrator and the Viewer / Auditor, never a key', async () => {
    for (const role of ['administrator', 'viewer_auditor'] as const) {
      const o = await getAssistantOverview(contextOf(role, 'private'));
      expect(o).toMatchObject({ set_in: 'server_environment', window_days: 7, data_source: 'SYNTHETIC' });
      expect(['on', 'off', 'not_configured']).toContain(o.status);
      expect(['configured', 'not_configured', 'not_needed']).toContain(o.key);
      expect(JSON.stringify(o)).not.toMatch(/sk-|OPENDISPATCH_ASSISTANT_API_KEY/);
    }
  });

  it('is refused for roles without the module', async () => {
    for (const role of ['planner', 'dispatch_supervisor', 'dispatcher', 'remote_team_lead', 'change_approver'] as const) {
      await expect(getAssistantOverview(contextOf(role, 'private')), role).rejects.toMatchObject({ code: 'forbidden' });
    }
  });
});

describe('testConnection', () => {
  it('takes no argument, returns a code only, is audited and refreshes the page', async () => {
    expect(testConnection.length).toBe(0);
    const status = (await getAssistantOverview(contextOf('administrator', 'private'))).status;
    const result = await testConnection();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (status === 'off') expect(result.data).toEqual({ ok: false, durationMs: 0, errorCode: 'off' });
    if (status === 'not_configured') expect(result.data.errorCode).toBe('not_configured');
    const audited = await events();
    expect(audited.at(0)).toMatchObject({ entity_type: 'assistant', outcome: result.data.ok ? 'success' : 'failure' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/ai-assistant', '/ar/admin/ai-assistant']);
    const after = await getAssistantOverview(contextOf('administrator', 'private'));
    expect(after.last_test).toMatchObject({ ok: result.data.ok });
  });

  it('is refused for the Viewer / Auditor and other roles, audited as denied', async () => {
    for (const role of ['viewer_auditor', 'planner'] as const) {
      session.role = role;
      expect(await testConnection(), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events()).every((e) => e.outcome === 'denied')).toBe(true);
    session.role = null;
    expect(await testConnection()).toMatchObject({ ok: false, code: 'unauthenticated' });
  });
});
