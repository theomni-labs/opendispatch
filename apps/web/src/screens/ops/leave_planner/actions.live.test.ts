// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { bulkDecideLeaveAction, createLeaveRequestAction, decideLeaveAction } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Shared with other live files and prior runs of
// this file: dates are randomized so create never
// clashes across runs.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

// The server actions vs the real data layer and
// fixtures, demo store in a temp folder.

const session = vi.hoisted(() => ({ role: 'planner' as string | null, mode: 'private' as string, zoneIds: [] as string[], revalidate: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: session.revalidate }));
vi.mock('@/lib/data/context', async (original) => {
  const real = await original<typeof import('@/lib/data/context')>();
  return {
    ...real,
    requireRequestContext: async () => {
      if (session.role === null) throw new UnauthenticatedError();
      return contextOf(session.role as Role, session.mode as InstallMode, session.zoneIds);
    },
  };
});

function contextOf(role: Role, installMode: InstallMode, zoneIds: string[]): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

/** RD-N, RD-S: zones with a requested leave each. */
const RD_N = 'eecf5c7f-237c-443c-b331-b75ba3fb26fc';
const RD_S = '41202fec-ca6a-4438-a061-54ca54a7a41a';
const OMAR_AGENT = '399c9242-f8b0-4d3f-bad6-08db8846b75f';

// A random year: create refuses an overlap, and
// Postgres is not reset between runs.
const RUN_YEAR = 2031 + Math.floor(Math.random() * 60);
let day = 0;
function nextDate(): string {
  day += 1;
  const d = ((day - 1) % 27) + 1;
  const m = (1 + Math.floor((day - 1) / 27)) % 12 || 12;
  return `${RUN_YEAR}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  session.role = 'planner';
  session.mode = 'private';
  session.zoneIds = [RD_N, RD_S];
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});

async function ctx(role: Role = 'planner', zoneIds: string[] = [RD_N, RD_S]): Promise<RequestContext> {
  return contextOf(role, 'private', zoneIds);
}

const events = async (action: string) => (await listAuditEvents(await ctx('administrator', []), { action, limit: 200 })).items;

/**
 * A fresh, disposable leave request nobody "entered": written through the raw internal CRUD (not
 * createLeaveRequest), so created_by is null and no live session is ever its self-decider. Go
 * re-derives the caller's user id from the signed role server-side, so a forged
 * RequestContext.userId no longer dodges the self-decide rule the way it used to.
 */
async function freshRequestId(): Promise<string> {
  const base = await ctx('planner');
  const date = nextDate();
  const at = new Date().toISOString();
  const res = await fetch(`${process.env['OPENDISPATCH_API_URL']}/_internal/leave-requests`, {
    method: 'POST',
    headers: { 'x-opendispatch-tenant-id': base.customerId, 'content-type': 'application/json' },
    body: JSON.stringify({ id: randomUUID(), data_source: 'SYNTHETIC', agent_id: OMAR_AGENT, start_date: date, end_date: date, leave_type: 'annual', status: 'requested', requested_at: at }),
  });
  const { data } = (await res.json()) as { data: { id: string } };
  return data.id;
}

describe.skipIf(!hasApi)('leave_planner actions (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

  describe('createLeaveRequestAction', () => {
    it('creates a leave request for an agent in the zone, audits it and revalidates', async () => {
      const date = nextDate();
      const result = await createLeaveRequestAction({ agentId: OMAR_AGENT, startDate: date, endDate: date, leaveType: 'annual' });
      expect(result).toMatchObject({ ok: true, data: { agent_id: OMAR_AGENT, status: 'requested', leave_type: 'annual' } });
      expect((await events('leave.requested')).at(0)).toMatchObject({ outcome: 'success' });
      expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/ops/leave-planner', '/ar/ops/leave-planner']);
    });

    it('refuses invalid dates and an agent outside the zone', async () => {
      const date = nextDate();
      const badDates = await createLeaveRequestAction({ agentId: OMAR_AGENT, startDate: date, endDate: `${RUN_YEAR - 1}-12-01`, leaveType: 'annual' });
      expect(badDates).toMatchObject({ ok: false, code: 'invalid' });
      session.zoneIds = [RD_S];
      const outsideZone = await createLeaveRequestAction({ agentId: OMAR_AGENT, startDate: date, endDate: date, leaveType: 'annual' });
      expect(outsideZone).toMatchObject({ ok: false, code: 'forbidden' });
    });

    it('is refused for a role with no access to Leave Planner', async () => {
      session.role = 'dispatcher';
      const date = nextDate();
      const result = await createLeaveRequestAction({ agentId: OMAR_AGENT, startDate: date, endDate: date, leaveType: 'annual' });
      expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    });
  });

  describe('decideLeaveAction', () => {
    it('approves a requested row, audits it and revalidates', async () => {
      const id = await freshRequestId();
      const result = await decideLeaveAction({ requestId: id, decision: 'approved' });
      expect(result).toMatchObject({ ok: true, data: { id, status: 'approved' } });
      expect((await events('leave.approved')).at(0)).toMatchObject({ outcome: 'success' });
    });

    it('declines a requested row', async () => {
      const id = await freshRequestId();
      const result = await decideLeaveAction({ requestId: id, decision: 'declined' });
      expect(result).toMatchObject({ ok: true, data: { id, status: 'declined' } });
    });

    it('refuses a second decision (conflict) and a request nobody may decide themselves', async () => {
      const id = await freshRequestId();
      await decideLeaveAction({ requestId: id, decision: 'approved' });
      const again = await decideLeaveAction({ requestId: id, decision: 'declined' });
      expect(again).toMatchObject({ ok: false, code: 'conflict' });
      // A request this Planner entered: no self-decide.
      const date = nextDate();
      const created = await createLeaveRequestAction({ agentId: OMAR_AGENT, startDate: date, endDate: date, leaveType: 'other' });
      if (!created.ok) throw new Error('setup failed');
      const own = await decideLeaveAction({ requestId: created.data.id, decision: 'approved' });
      expect(own).toMatchObject({ ok: false, code: 'forbidden' });
    });

    it('is refused for a role with no edit access', async () => {
      const id = await freshRequestId();
      session.role = 'dispatch_supervisor';
      const result = await decideLeaveAction({ requestId: id, decision: 'approved' });
      expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    });
  });

  describe('bulkDecideLeaveAction', () => {
    it('decides several requests and skips one entered by the same Planner', async () => {
      const idA = await freshRequestId();
      const idB = await freshRequestId();
      const date = nextDate();
      const created = await createLeaveRequestAction({ agentId: OMAR_AGENT, startDate: date, endDate: date, leaveType: 'sick' });
      if (!created.ok) throw new Error('setup failed');
      const result = await bulkDecideLeaveAction({ requestIds: [idA, idB, created.data.id], decision: 'approved' });
      expect(result).toMatchObject({ ok: true, data: { decided: 2, skipped: 1 } });
    });

    it('refuses empty input', async () => {
      const result = await bulkDecideLeaveAction({ requestIds: [], decision: 'approved' });
      expect(result).toMatchObject({ ok: false, code: 'invalid' });
    });
  });
});

// No live api below: input validation and static
// source checks only; nothing reaches leave.ts.

describe('every action', () => {
  it('answers `unauthenticated` with no session, and leaks no input on an unexpected error', async () => {
    session.role = null;
    expect(await decideLeaveAction({ requestId: 'x', decision: 'approved' })).toMatchObject({ ok: false, code: 'unauthenticated' });
    session.role = 'planner';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2');
        },
      },
    );
    const result = await decideLeaveAction(hostile as never);
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
    expect([...new Set(exported)].filter((kind) => kind !== 'interface')).toEqual(['async']);
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
