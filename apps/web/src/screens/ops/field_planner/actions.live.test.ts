// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listRosterAssignments, listRosters } from '@/lib/data/rosters';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { approveOverrideAction, approveRosterAction, buildRosterAction, buildWeekAction, createOverrideAction, publishRosterAction, publishWeekAction, rejectOverrideAction, rejectRosterAction, submitRosterAction, submitWeekAction } from './actions';
import { freshDate } from '../../../../test/live-fixtures';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Server actions vs the real data layer and
// fixtures, demo store in a temp folder.

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
// Band 4 of live-fixtures.ts: the week of 2026-11-08
const WEEK_DAY = '2026-11-12';

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
const rosterOn = async (date: string) => (await listRosters(await ctx(), { zone_id: RD_C, date })).items[0]!;
const events = async (action: string) => (await listAuditEvents(await ctx('administrator'), { action, limit: 200 })).items;

async function freshSubmittedRoster(): Promise<{ id: string }> {
  const built = await buildRosterAction({ zoneId: RD_C, date: freshDate(3) });
  if (!built.ok) throw new Error('build failed');
  const submitted = await submitRosterAction({ rosterId: built.data.id });
  if (!submitted.ok) throw new Error('submit failed');
  return { id: built.data.id };
}

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Every action here goes through rosters.ts.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

describe.skipIf(!hasApi)('roster actions (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

describe('submitRosterAction', () => {
  it('submits a draft roster for approval, opens an approval and audits it', async () => {
    const built = await buildRosterAction({ zoneId: RD_C, date: freshDate(3) });
    if (!built.ok) throw new Error('build failed');
    expect(built.data.status).toBe('draft');
    const result = await submitRosterAction({ rosterId: built.data.id });
    expect(result).toMatchObject({ ok: true, data: { status: 'submitted' } });
    expect((await rosterOn(built.data.roster_date)).status).toBe('submitted');
    expect((await events('roster.submitted')).at(0)).toMatchObject({ outcome: 'success' });
    // Build and submit each revalidate: two pairs.
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/ops/field-planner', '/ar/ops/field-planner', '/en/ops/field-planner', '/ar/ops/field-planner']);
  });

  it('is refused (conflict) for a roster that is not draft or rejected, and refused for a role with no edit access', async () => {
    const submitted = await rosterOn('2026-09-14');
    expect(await submitRosterAction({ rosterId: submitted.id })).toMatchObject({ ok: false, code: 'conflict' });
    session.role = 'viewer_auditor';
    const draft = await rosterOn('2026-09-17');
    expect(await submitRosterAction({ rosterId: draft.id })).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('approveRosterAction and rejectRosterAction (nobody approves their own request)', () => {
  it('a Dispatch Supervisor approves a submitted roster; publish then becomes possible', async () => {
    const submitted = await freshSubmittedRoster();
    session.role = 'dispatch_supervisor';
    const result = await approveRosterAction({ rosterId: submitted.id, note: 'Looks fine' });
    expect(result).toMatchObject({ ok: true, data: { status: 'approved' } });
    expect((await events('roster.approved')).at(0)).toMatchObject({ outcome: 'success' });
  });

  it('rejecting is recorded as its own status (rejected, distinct from draft, per rosters.ts), audited, and a Planner (not the approver role) is refused', async () => {
    const submitted = await freshSubmittedRoster();
    session.role = 'dispatch_supervisor';
    expect(await rejectRosterAction({ rosterId: submitted.id })).toMatchObject({ ok: true, data: { status: 'rejected' } });
    expect((await events('roster.rejected')).at(0)).toMatchObject({ outcome: 'success' });
    session.role = 'planner';
    const own = await buildRosterAction({ zoneId: RD_C, date: freshDate(3) });
    if (!own.ok) throw new Error('build failed');
    await submitRosterAction({ rosterId: own.data.id });
    expect(await approveRosterAction({ rosterId: own.data.id })).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('publishRosterAction (LABELLED STUB)', () => {
  it('only publishes an approved roster, and never actually sends anything', async () => {
    const submitted = await freshSubmittedRoster();
    session.role = 'dispatch_supervisor';
    await approveRosterAction({ rosterId: submitted.id });
    const result = await publishRosterAction({ rosterId: submitted.id });
    expect(result).toMatchObject({ ok: true, data: { stub: true, published: false } });
    expect((await events('roster.publish_stub')).at(0)).toMatchObject({ outcome: 'success' });
  });

  it('refuses to publish a roster that is not approved', async () => {
    const built = await buildRosterAction({ zoneId: RD_C, date: freshDate(3) });
    if (!built.ok) throw new Error('build failed');
    expect(await publishRosterAction({ rosterId: built.data.id })).toMatchObject({ ok: false, code: 'conflict' });
  });
});

describe('buildRosterAction', () => {
  it('builds a roster for a zone and day with the placeholder optimizer', async () => {
    const result = await buildRosterAction({ zoneId: RD_C, date: '2026-09-20' });
    expect(result).toMatchObject({ ok: true, data: { zone_id: RD_C, roster_date: '2026-09-20', status: 'draft' } });
    expect((await events('roster.built')).at(0)).toMatchObject({ outcome: 'success' });
  });

  it('refuses a date in the past, and refuses with no zone or date', async () => {
    expect(await buildRosterAction({ zoneId: RD_C, date: '2020-01-01' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await buildRosterAction({ zoneId: '', date: '' })).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('buildWeekAction, submitWeekAction, publishWeekAction', () => {
  it('builds the open days of the week in the planner zone, submits them, and publish stays a stub', async () => {
    const day = WEEK_DAY;
    const built = await buildWeekAction({ weekStart: day });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.data.done.length).toBeGreaterThan(0);
    expect(built.data.done.every((r) => r.zone_id === RD_C && r.status === 'draft')).toBe(true);
    expect(built.data.done.length + built.data.skipped.length).toBe(7);
    expect((await events('roster.week_built')).length).toBeGreaterThan(0);
    const submitted = await submitWeekAction({ weekStart: day });
    expect(submitted.ok && submitted.data.done.length).toBe(built.data.done.length);
    const published = await publishWeekAction({ weekStart: day });
    expect(published.ok && published.data.stub === true && published.data.done.length === 0).toBe(true);
  });

  it('refuses a role with no edit access and a week with no day', async () => {
    session.role = 'viewer_auditor';
    expect(await buildWeekAction({ weekStart: WEEK_DAY })).toMatchObject({ ok: false, code: 'forbidden' });
    session.role = 'planner';
    expect(await buildWeekAction({ weekStart: '' })).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('createOverrideAction, approveOverrideAction, rejectOverrideAction', () => {
  it('proposes an override with a reason, opens an approval, and a Dispatch Supervisor may approve it (the change then applies)', async () => {
    const built = await buildRosterAction({ zoneId: RD_C, date: freshDate(3) });
    if (!built.ok) throw new Error('build failed');
    const roster = { id: built.data.id };
    const lines = (await listRosterAssignments(await ctx(), roster.id, { limit: 200 })).items;
    const line = lines[0]!;
    const assignedIds = new Set(lines.map((l) => l.agent_id));
    const agent = (await (await import('@/lib/data/people')).listAgents(await ctx(), { zone_id: RD_C, kind: 'field', is_active: true, limit: 200 })).items.find((s) => !assignedIds.has(s.id))!;
    const created = await createOverrideAction({
      rosterId: roster.id,
      change_type: 'replace_agent',
      reason_code: 'agent_unavailable',
      roster_assignment_id: line.id,
      agent_id: agent.id,
    });
    expect(created).toMatchObject({ ok: true, data: { status: 'pending', change_type: 'replace_agent' } });
    expect((await events('override.created')).at(0)).toMatchObject({ outcome: 'success' });
    if (!created.ok) throw new Error('unreachable');

    session.role = 'dispatch_supervisor';
    const approved = await approveOverrideAction({ overrideId: created.data.id });
    expect(approved).toMatchObject({ ok: true, data: { status: 'approved' } });
    const updated = (await listRosterAssignments(await ctx(), roster.id, { limit: 200 })).items.find((a) => a.id === line.id);
    expect(updated?.agent_id).toBe(agent.id);
    expect(updated?.is_override).toBe(true);
  });

  it('refuses an override with no reason code, and "other" with no note', async () => {
    const built = await buildRosterAction({ zoneId: RD_C, date: freshDate(3) });
    if (!built.ok) throw new Error('build failed');
    const roster = { id: built.data.id };
    const line = (await listRosterAssignments(await ctx(), roster.id, { limit: 1 })).items[0]!;
    expect(await createOverrideAction({ rosterId: roster.id, change_type: 'remove_assignment', reason_code: '' as never, roster_assignment_id: line.id })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await createOverrideAction({ rosterId: roster.id, change_type: 'remove_assignment', reason_code: 'other', roster_assignment_id: line.id, note: '' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('rejecting an override changes nothing on the roster, and a role with no edit access is refused', async () => {
    const built = await buildRosterAction({ zoneId: RD_C, date: freshDate(3) });
    if (!built.ok) throw new Error('build failed');
    const roster = { id: built.data.id };
    const line = (await listRosterAssignments(await ctx(), roster.id, { limit: 1 })).items[0]!;
    const created = await createOverrideAction({ rosterId: roster.id, change_type: 'remove_assignment', reason_code: 'dispatcher_judgement', roster_assignment_id: line.id });
    if (!created.ok) throw new Error('unreachable');
    session.role = 'dispatch_supervisor';
    expect(await rejectOverrideAction({ overrideId: created.data.id })).toMatchObject({ ok: true, data: { status: 'rejected' } });
    expect((await listRosterAssignments(await ctx(), roster.id, { limit: 200 })).items.some((a) => a.id === line.id)).toBe(true);
    session.role = 'viewer_auditor';
    expect(await createOverrideAction({ rosterId: roster.id, change_type: 'remove_assignment', reason_code: 'dispatcher_judgement', roster_assignment_id: line.id })).toMatchObject({ ok: false, code: 'forbidden' });
  });
});
});

describe('every action', () => {
  it('answers `unauthenticated` with no session, and leaks no input on an unexpected error', async () => {
    session.role = null;
    expect(await submitRosterAction({ rosterId: RD_C })).toMatchObject({ ok: false, code: 'unauthenticated' });
    session.role = 'planner';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2');
        },
      },
    );
    const result = await submitRosterAction(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result) + errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|boom/);
  });
});

describe('the server-built context rule in this file', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
  // Input shapes live in types.ts, not inline: a
  // client file (OverrideDrawer) needs two value
  // exports (REASON_CODES, CHANGE_TYPES), and
  // importing from actions.ts/view.ts instead would
  // pull server-only code into the browser bundle
  // (a real Turbopack build failure, traced here).
  const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

  it('is a use-server file whose exports are all async functions', () => {
    expect(source.trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect([...new Set(exported)]).toEqual(['async']);
    expect(exported).toHaveLength(11);
  });

  it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) {
      expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
    }
    const fields = [...types.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
    expect(fields.length).toBeGreaterThan(5);
    for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
  });

  it('types.ts (the input shapes and the two override vocabularies) imports nothing from lib/data: a client file may import its values safely', () => {
    expect(types).not.toMatch(/from ['"]@\/lib\/data/);
  });
});
