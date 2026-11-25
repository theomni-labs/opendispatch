// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { updateUser } from '@/lib/data/users';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { exportAuditLog } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The export action against the real data layer and the committed fixtures, with the demo store in a temp folder. The session
// is the only thing stood in for: requireRequestContext returns the context of the role the test picks.
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

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  // Go audit events; no server is fine.
  const goUrl = process.env['OPENDISPATCH_API_URL'];
  if (goUrl) await fetch(`${goUrl}/_internal/test/reset`, { method: 'POST' }).catch(() => undefined);
  session.role = 'administrator';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});

const BOM = '﻿';
const lines = (text: string) => text.replace(BOM, '').split('\r\n');

describe('exportAuditLog', () => {
  it('returns the whole log as a CSV file: a byte order mark, the record\'s own field names, newest first, actor names filled in', async () => {
    const result = await exportAuditLog({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mime).toBe('text/csv;charset=utf-8');
    expect(result.data.filename).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.data.text.startsWith(BOM)).toBe(true);
    const rows = lines(result.data.text);
    expect(rows[0]).toBe('occurred_at,actor,actor_type,action,entity_type,entity_id,outcome,summary_en,correlation_id');
    expect(rows).toHaveLength(24);
    expect(rows[1]).toContain('integration.health_changed');
    expect(rows.find((row) => row.includes('rule.approved'))).toContain('Fahad Al-Musari');
  });

  it('exports what the filter says: the same rows the page lists for it', async () => {
    const result = await exportAuditLog({ category: 'rules', outcome: 'success', q: 'RULE-00' });
    if (!result.ok) throw new Error('export failed');
    expect(lines(result.data.text)).toHaveLength(5);
    const denied = await exportAuditLog({ outcome: 'denied' });
    if (!denied.ok) throw new Error('export failed');
    expect(lines(denied.data.text)).toHaveLength(2);
    expect(lines(denied.data.text)[1]).toContain('auth.sign_in');
  });

  it('is open to the Viewer / Auditor and the Change Approver, and reads no more than the page does', async () => {
    for (const role of ['viewer_auditor', 'change_approver'] as const) {
      session.role = role;
      const result = await exportAuditLog({});
      expect(result.ok, role).toBe(true);
      if (result.ok) expect(lines(result.data.text), role).toHaveLength(24);
    }
  });

  it('is refused, as `forbidden`, for a role with no access to the log, and for the Change Approver outside a private install', async () => {
    session.role = 'planner';
    expect(await exportAuditLog({})).toMatchObject({ ok: false, code: 'forbidden' });
    session.role = 'change_approver';
    session.mode = 'shared';
    expect(await exportAuditLog({})).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('refuses a filter that is not on its allow-list, so an export is never wider than asked', async () => {
    for (const bad of [{ outcome: 'root' }, { category: 'everything' }, { period: 'forever' }]) expect(await exportAuditLog(bad), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('ignores an empty filter and fields it does not name (a crafted body cannot add a role, customer or user)', async () => {
    const result = await exportAuditLog({ q: '', outcome: '', role: 'administrator', customerId: 'someone-else', actor_user_id: 'x' } as never);
    expect(result.ok).toBe(true);
    if (result.ok) expect(lines(result.data.text)).toHaveLength(24);
  });

  it('treats input that is not an object as no filter, and exports nothing beyond the log', async () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      const result = await exportAuditLog(bad as never);
      expect(result.ok, String(bad)).toBe(true);
    }
  });

  it('answers `unauthenticated` with no session', async () => {
    session.role = null;
    expect(await exportAuditLog({})).toMatchObject({ ok: false, code: 'unauthenticated' });
  });

  it('writes nothing to the log: an export is a read', async () => {
    const before = (await listAuditEvents(contextOf('administrator', 'private'), { limit: 1 })).page.total;
    await exportAuditLog({});
    expect((await listAuditEvents(contextOf('administrator', 'private'), { limit: 1 })).page.total).toBe(before);
    expect(session.revalidate).not.toHaveBeenCalled();
  });

  it('neutralises a spreadsheet formula in the data (an actor whose name is =2+2 is written as text)', async () => {
    const ctx = contextOf('administrator', 'private');
    await updateUser(ctx, ctx.userId, { display_name: '=2+2', assigned_role: 'administrator', zone_ids: [] });
    const result = await exportAuditLog({ q: 'user.updated' });
    if (!result.ok) throw new Error('export failed');
    const rows = lines(result.data.text);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain(",'=2+2,");
  });

  it('returns an unexpected error as a reference and leaks nothing', async () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError('boom: token=hunter2');
      },
    });
    const result = await exportAuditLog(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result)).not.toMatch(/hunter2|boom/);
    expect(errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|boom/);
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
    const inputTypes = types.slice(types.indexOf('What the browser sends'));
    const fields = [...inputTypes.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
    expect(fields.length).toBe(4);
    for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
  });
});
