// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { runSimulationAction } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The real runs moved to actions.live.test.ts.

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

describe('every action', () => {
  it('answers `unauthenticated` with no session, and leaks no input on an unexpected error', async () => {
    session.role = null;
    expect(await runSimulationAction({ rosterId: 'x', runDate: '2026-09-12', policy: 'nearest' })).toMatchObject({ ok: false, code: 'unauthenticated' });
    session.role = 'planner';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2');
        },
      },
    );
    const result = await runSimulationAction(hostile as never);
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
