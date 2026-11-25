// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { getBackupStatus } from '@/lib/data/system';
import { confirmBackupDone, createDiagnostics } from './actions';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions against the real data layer and its seeds, with the demo store in a temp folder. The session is the only thing
// stood in for: requireRequestContext returns the context of the role the test picks. Both actions take no argument.
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
  await resetGoTestState();
  session.role = 'administrator';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});

async function adminContext(): Promise<RequestContext> {
  return contextOf('administrator', 'private');
}
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;

describe('confirmBackupDone (a record that the customer took a backup)', () => {
  it('confirms a backup now, by the caller, as customer reported; audits it and refreshes the page in both languages', async () => {
    const result = await confirmBackupDone();
    expect(result).toMatchObject({ ok: true, data: { confirmedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) } });
    const status = await getBackupStatus(await adminContext());
    expect(status).toMatchObject({ source: 'customer_reported', confirmed_by_user_id: (await adminContext()).userId });
    expect(Date.now() - Date.parse(status.last_confirmed_at as string)).toBeLessThan(60_000);
    expect((await events('backup.confirmed')).at(0)).toMatchObject({ outcome: 'success', entity_type: 'backup' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/system-health', '/ar/admin/system-health']);
  });

  it('takes no argument: there is nothing a person types', () => {
    expect(confirmBackupDone.length).toBe(0);
    expect(createDiagnostics.length).toBe(0);
  });

  it('is refused for every other role (audited as denied), and with no session as `unauthenticated`', async () => {
    const before = JSON.stringify(await getBackupStatus(await adminContext()));
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      session.role = role;
      expect(await confirmBackupDone(), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events('backup.confirmed')).every((e) => e.outcome === 'denied')).toBe(true);
    expect(JSON.stringify(await getBackupStatus(await adminContext()))).toBe(before);
    session.role = null;
    expect(await confirmBackupDone()).toMatchObject({ ok: false, code: 'unauthenticated' });
  });
});

describe('createDiagnostics (a labelled stub: the file is scripted)', () => {
  it('creates the file, audits it, and returns an archive: a name, the zip type, the bytes as base64 and the size', async () => {
    const result = await createDiagnostics();
    expect(result).toMatchObject({ ok: true, data: { fileName: expect.stringMatching(/^opendispatch-diagnostics-\d{4}-\d{2}-\d{2}\.zip$/), contentType: 'application/zip', sizeBytes: expect.any(Number) } });
    if (!result.ok) return;
    const bytes = Buffer.from(result.data.contentBase64, 'base64');
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(bytes.length).toBe(result.data.sizeBytes);
    expect((await events('diagnostics.created')).at(0)).toMatchObject({ outcome: 'success', entity_type: 'diagnostics_bundle' });
  });

  it('holds only settings, health and job runs and a README, and no case or personal data', async () => {
    const result = await createDiagnostics();
    if (!result.ok) throw new Error('not created');
    const text = Buffer.from(result.data.contentBase64, 'base64').toString('utf8');
    for (const name of ['README.txt', 'settings.json', 'health.json', 'jobs.json']) expect(text).toContain(name);
    expect(text).toContain('Case data and personal data are removed. Nothing is sent automatically.');
    // no person's name or e-mail address, no case, no coordinates
    expect(text).not.toMatch(/@demo-synthetic|Nadia|Al-Ghalani|"email"|case_id|latitude|longitude/);
  });

  it('is refused for every other role (audited as denied) and creates nothing', async () => {
    for (const role of ['planner', 'viewer_auditor', 'change_approver'] as const) {
      session.role = role;
      expect(await createDiagnostics(), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events('diagnostics.created')).every((e) => e.outcome === 'denied')).toBe(true);
    session.role = null;
    expect(await createDiagnostics()).toMatchObject({ ok: false, code: 'unauthenticated' });
  });
});

describe('an unexpected error', () => {
  it('returns a reference ODP- and 8 hex characters, logs only that reference and the error name, and leaks nothing', async () => {
    // A session whose context cannot be built throws a plain Error inside runAction: not one of the data layer's five.
    session.role = 'not-a-role';
    for (const call of [confirmBackupDone, createDiagnostics]) {
      const result = await call();
      expect(result).toMatchObject({ ok: false, code: 'unexpected' });
      if (result.ok) throw new Error('unreachable');
      expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
      expect(JSON.stringify(result)).not.toMatch(/no context/);
      expect(errorLog.mock.calls.flat().join('\n')).toContain(result.reference);
      expect(errorLog.mock.calls.flat().join('\n')).not.toMatch(/no context for/);
    }
  });
});

describe('the server-built context rule in this file', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');

  it('is a use-server file whose exports are all async functions with no parameter at all', () => {
    expect(source.trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported.length).toBe(2);
    expect([...new Set(exported)]).toEqual(['async']);
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) expect(signature).toBe('');
  });
});
