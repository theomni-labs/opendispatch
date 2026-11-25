// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listAgents } from '@/lib/data/people';
import { listRemoteQueue } from '@/lib/data/remote';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { assignReviewerAction } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server action vs the real data layer and
// fixtures, demo store in a temp folder.

const session = vi.hoisted(() => ({ role: 'remote_team_lead' as string | null, mode: 'private' as string, revalidate: vi.fn() }));

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

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  session.role = 'remote_team_lead';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});

async function ctx(role: Role = 'remote_team_lead'): Promise<RequestContext> {
  return contextOf(role, 'private');
}

const events = async (action: string) => (await listAuditEvents(await ctx('administrator'), { action, limit: 200 })).items;

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Candidates come from Agent.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

/** Tries every active remote agent against `caseId` until one is accepted (a refusal mutates nothing). */
async function assignFirstEligible(caseId: string) {
  const candidates = (await listAgents(await ctx(), { kind: 'remote', is_active: true, limit: 200 })).items;
  for (const agent of candidates) {
    const result = await assignReviewerAction({ caseId, agentId: agent.id });
    if (result.ok) return { result, agentId: agent.id };
  }
  throw new Error(`No assignable remote agent found for case ${caseId}.`);
}

describe.skipIf(!hasApi)('assignReviewerAction (live, real api and Postgres)', () => {
  it('assigns an eligible remote agent to a waiting case, audits it and revalidates the route', async () => {
    const item = (await listRemoteQueue(await ctx(), { status: 'waiting', limit: 200 })).items[0]!;
    const { result, agentId } = await assignFirstEligible(item.case_id);
    expect(result).toMatchObject({ ok: true, data: { status: 'in_review', assigned_reviewer_id: agentId } });
    expect((await events('remote_queue.reviewer_assigned')).at(0)).toMatchObject({ outcome: 'success' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/ops/remote-queue', '/ar/ops/remote-queue']);
  });

  it('refuses a second assignment of the same case (conflict) and an unknown agent id (invalid)', async () => {
    const item = (await listRemoteQueue(await ctx(), { status: 'waiting', limit: 200 })).items[0]!;
    const { agentId } = await assignFirstEligible(item.case_id);
    const other = (await listAgents(await ctx(), { kind: 'remote', is_active: true, limit: 200 })).items.find((s) => s.id !== agentId)!;
    expect(await assignReviewerAction({ caseId: item.case_id, agentId: other.id })).toMatchObject({ ok: false, code: 'conflict' });
    const another = (await listRemoteQueue(await ctx(), { status: 'waiting', limit: 200 })).items[0]!;
    expect(await assignReviewerAction({ caseId: another.case_id, agentId: 'not-a-uuid' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('is refused for a role with no access to Remote Queue and Scheduling', async () => {
    const item = (await listRemoteQueue(await ctx(), { status: 'waiting', limit: 200 })).items[0]!;
    const agent = (await listAgents(await ctx(), { kind: 'remote', is_active: true, limit: 1 })).items[0]!;
    session.role = 'dispatcher';
    expect(await assignReviewerAction({ caseId: item.case_id, agentId: agent.id })).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('every action', () => {
  it('answers `unauthenticated` with no session, and leaks no input on an unexpected error', async () => {
    session.role = null;
    expect(await assignReviewerAction({ caseId: 'x', agentId: 'y' })).toMatchObject({ ok: false, code: 'unauthenticated' });
    session.role = 'remote_team_lead';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2');
        },
      },
    );
    const result = await assignReviewerAction(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result) + errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|boom/);
  });
});

describe('the server-built context rule in this file', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
  const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

  it('is a use-server file whose exports are all async functions', () => {
    expect(source.trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect([...new Set(exported)]).toEqual(['async']);
  });

  it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) {
      expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
    }
    const fields = [...types.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
  });

  it('types.ts imports nothing from lib/data: a client file may import its values safely', () => {
    expect(types).not.toMatch(/from ['"]@\/lib\/data/);
  });
});
