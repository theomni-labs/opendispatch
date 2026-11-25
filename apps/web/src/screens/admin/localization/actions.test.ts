// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { getLocalizationSettings } from '@/lib/data/system';
import { resetLocalization, saveLocalization } from './actions';
import { DEFAULT_SETTINGS } from './types';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions against the real data layer and the committed fixtures, with the demo store in a temp folder. The session is the
// only thing stood in for: requireRequestContext returns the context of the role the test picks.
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
const stored = async () => await getLocalizationSettings(await adminContext());

const settings = (change: Record<string, unknown> = {}) => ({ default_locale: 'ar', digit_system: 'arabic_indic', primary_calendar: 'hijri', show_secondary_calendar: false, first_day_of_week: 'saturday', ...change });

describe('saveLocalization (stored and audited, not applied)', () => {
  it('saves the five settings, keeps the time zone fixed, audits from and to, and refreshes the page in both languages', async () => {
    const result = await saveLocalization(settings() as never);
    expect(result).toMatchObject({ ok: true, data: { default_locale: 'ar', digit_system: 'arabic_indic', primary_calendar: 'hijri', show_secondary_calendar: false, first_day_of_week: 'saturday' } });
    expect(await stored()).toEqual({ default_locale: 'ar', digit_system: 'arabic_indic', primary_calendar: 'hijri', show_secondary_calendar: false, time_zone: 'Asia/Riyadh', first_day_of_week: 'saturday' });
    const audit = (await events('localization.updated')).at(0);
    expect(audit).toMatchObject({ outcome: 'success', entity_id: 'localization' });
    expect(audit?.detail).toMatchObject({ from: { default_locale: 'en' }, to: { default_locale: 'ar' } });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/localization', '/ar/admin/localization']);
  });

  it('never takes a time zone from the browser: one sent is dropped, and the stored one stays Asia/Riyadh', async () => {
    expect(await saveLocalization(settings({ time_zone: 'Europe/London' }) as never)).toMatchObject({ ok: true });
    expect((await stored()).time_zone).toBe('Asia/Riyadh');
  });

  it.each([
    ['a language that does not exist', { default_locale: 'fr' }],
    ['a digit system that does not exist', { digit_system: 'thai' }],
    ['a calendar that does not exist', { primary_calendar: 'julian' }],
    ['a first day that does not exist', { first_day_of_week: 'friday' }],
    ['a secondary calendar that is not a boolean', { show_secondary_calendar: 'yes' }],
    ['a missing setting', { default_locale: undefined }],
  ])('refuses %s, as `invalid`, and changes nothing', async (_name, change) => {
    expect(await saveLocalization(settings(change as Record<string, unknown>) as never)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await stored()).toMatchObject({ default_locale: 'en', digit_system: 'western' });
    expect(await events('localization.updated')).toHaveLength(0);
  });

  it('never forwards a field it does not name, and refuses input that is not an object', async () => {
    expect(await saveLocalization({ ...settings(), role: 'administrator', customerId: 'other', extra: {} } as never)).toMatchObject({ ok: true });
    for (const bad of [null, undefined, 'x', 42, []]) expect(await saveLocalization(bad as never), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('is refused for every other role (audited as denied), leaving the settings alone, and with no session as `unauthenticated`', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      session.role = role;
      expect(await saveLocalization(settings() as never), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events('localization.updated')).every((e) => e.outcome === 'denied')).toBe(true);
    expect(await stored()).toMatchObject({ default_locale: 'en' });
    session.role = null;
    expect(await saveLocalization(settings() as never)).toMatchObject({ ok: false, code: 'unauthenticated' });
  });
});

describe('resetLocalization', () => {
  it('writes the defaults of, audits the change, and takes no argument', async () => {
    await saveLocalization(settings() as never);
    const result = await resetLocalization();
    expect(result).toMatchObject({ ok: true, data: DEFAULT_SETTINGS });
    expect(await stored()).toEqual({ ...DEFAULT_SETTINGS, time_zone: 'Asia/Riyadh' });
    expect(await events('localization.updated')).toHaveLength(2);
    expect(resetLocalization.length).toBe(0);
  });

  it('is refused for other roles and audited as denied', async () => {
    session.role = 'viewer_auditor';
    expect(await resetLocalization()).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('localization.updated')).map((e) => e.outcome)).toEqual(['denied']);
  });
});

describe('an unexpected error', () => {
  it('returns a reference ODP- and 8 hex characters, logs only that reference and the error name, and leaks no input', async () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError('boom: token=hunter2');
      },
    });
    const result = await saveLocalization(hostile as never);
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
    expect(exported.length).toBe(2);
    expect([...new Set(exported)]).toEqual(['async']);
  });

  it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
    const inputTypes = types.slice(types.indexOf('What the browser sends'));
    const fields = [...inputTypes.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
    expect(fields.length).toBe(5);
    for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
  });
});
