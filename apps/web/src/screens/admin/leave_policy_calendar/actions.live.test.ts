// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import { getLeavePolicy, listCalendarEvents, listHolidays, listPrayerTimes } from '@/lib/data/time';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { recomputePrayer, removeHoliday, removeRange, saveHoliday, savePolicy, saveRange, setPayday } from './actions';
import type { SaveHolidayInput, SavePolicyInput } from './types';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Holidays are real Postgres, shared: names are randomized per call.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

// The session is the only thing stood in for: requireRequestContext returns the context of the role the test picks
//. The demo store (audit, settings) is still a temp folder, reset per test.
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

async function adminContext(): Promise<RequestContext> {
  return contextOf('administrator', 'private');
}
const holidays = async () => (await listHolidays(await adminContext(), { limit: 200 })).items;
const holiday = async (name: string) => (await holidays()).find((h) => h.name_en === name)!;
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;

// A fresh name every call: Postgres is shared and not reset between tests, unlike the demo store above.
const newHoliday = (): SaveHolidayInput => ({ name_en: `Live Test Day ${randomUUID().slice(0, 8)}`, name_ar: 'يوم اختبار', start_date: '2026-10-05', end_date: '2026-10-06', kind: 'observance' });
const policy: SavePolicyInput = { min_notice_days: 10, share_percent: 20, blackout_periods: [{ start_date: '2026-12-20', end_date: '2026-12-31', label_en: 'Year end' }] };

describe.skipIf(!hasApi)('leave_policy_calendar actions (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

  describe('saveHoliday', () => {
    it('adds a holiday, computes its Hijri dates from the Gregorian ones, audits it, and refreshes the page in both languages', async () => {
      const input = newHoliday();
      expect(await saveHoliday(input)).toMatchObject({ ok: true, data: { name: input.name_en, created: true } });
      expect(await holiday(input.name_en)).toMatchObject({ name_ar: 'يوم اختبار', start_date: '2026-10-05', end_date: '2026-10-06', kind: 'observance', data_source: 'SYNTHETIC', hijri_start: expect.objectContaining({ year: 1448 }) });
      expect((await events('holiday.created')).at(0)).toMatchObject({ outcome: 'success' });
      expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/leave-policy-calendar', '/ar/admin/leave-policy-calendar']);
    });

    it('adds a holiday with no Arabic name (null: English is shown), and changes one, and refuses the Hijri dates a browser would send', async () => {
      const input = newHoliday();
      expect(await saveHoliday({ ...input, name_ar: '' })).toMatchObject({ ok: true });
      const created = await holiday(input.name_en);
      expect(created.name_ar).toBeNull();
      const renamed = `${input.name_en} Renamed`;
      expect(await saveHoliday({ ...input, targetId: created.id, name_en: renamed, end_date: '2026-10-07', hijri_start: { year: 1, month: 1, day: 1 } } as never)).toMatchObject({ ok: true, data: { created: false } });
      expect(await holiday(renamed)).toMatchObject({ end_date: '2026-10-07', hijri_start: expect.objectContaining({ year: 1448 }) });
      expect((await events('holiday.updated')).at(0)?.outcome).toBe('success');
    });

    it.each([
      ['an empty name', { name_en: '' }, 'invalid'],
      ['an end before the start', { end_date: '2026-10-01' }, 'invalid'],
      ['a date that is not a date', { start_date: '05/10/2026' }, 'invalid'],
      ['a kind that is not one', { kind: 'feast' }, 'invalid'],
    ] as const)('refuses %s, with the data layer\'s English message, and adds nothing', async (_name, change, code) => {
      const before = (await holidays()).length;
      const result = await saveHoliday({ ...newHoliday(), ...change });
      expect(result).toMatchObject({ ok: false, code });
      if (!result.ok) expect(result.message).toMatch(/[A-Za-z]/);
      expect((await holidays()).length).toBe(before);
    });

    it('answers `not_found` for a holiday that does not exist and `invalid` for an id that is not one', async () => {
      const input = newHoliday();
      expect(await saveHoliday({ ...input, targetId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
      for (const bad of ['toString', '__proto__', '../etc']) expect(await saveHoliday({ ...input, targetId: bad }), bad).toMatchObject({ ok: false, code: 'invalid' });
    });

    it('is refused for every role that is not an Administrator, adding and changing, audited as denied', async () => {
      const one = await holiday('Founding Day');
      const input = newHoliday();
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
        session.role = role;
        expect(await saveHoliday(input), `${role} adds`).toMatchObject({ ok: false, code: 'forbidden' });
        expect(await saveHoliday({ ...input, targetId: one.id }), `${role} changes`).toMatchObject({ ok: false, code: 'forbidden' });
      }
      expect((await events('holiday.created')).length + (await events('holiday.updated')).length).toBe(12);
      expect([...(await events('holiday.created')), ...(await events('holiday.updated'))].every((e) => e.outcome === 'denied')).toBe(true);
      expect((await holiday('Founding Day')).name_en).toBe('Founding Day');
    });
  });

  describe('removeHoliday', () => {
    // A disposable holiday, not a fixture one: other live files read
    // "Founding Day" as a stable reference and would break if it vanished.
    async function disposableHoliday(): Promise<{ id: string; name: string }> {
      const input = newHoliday();
      const created = await saveHoliday(input);
      if (!created.ok) throw new Error('setup: saveHoliday failed');
      return { id: created.data.id, name: created.data.name };
    }

    it('deletes a holiday, audits it, and answers `not_found` the second time', async () => {
      const one = await disposableHoliday();
      expect(await removeHoliday({ targetId: one.id })).toMatchObject({ ok: true, data: { id: one.id, name: one.name } });
      expect((await holidays()).some((h) => h.id === one.id)).toBe(false);
      expect((await events('holiday.deleted')).at(0)).toMatchObject({ outcome: 'success', entity_id: one.id });
      expect(await removeHoliday({ targetId: one.id })).toMatchObject({ ok: false, code: 'not_found' });
      for (const bad of ['', 'toString', 42, null, undefined]) expect(await removeHoliday({ targetId: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
    });

    it('is refused for a viewer and for a Change Approver (who cannot even read the holidays), audited as denied, and deletes nothing', async () => {
      const one = await disposableHoliday();
      for (const role of ['viewer_auditor', 'change_approver'] as const) {
        session.role = role;
        expect(await removeHoliday({ targetId: one.id }), role).toMatchObject({ ok: false, code: 'forbidden' });
      }
      expect((await events('holiday.deleted')).map((e) => e.outcome)).toEqual(['denied', 'denied']);
      expect((await holidays()).some((h) => h.id === one.id)).toBe(true);
    });
  });

  describe('recomputePrayer', () => {
    it('stores the prayer times of every city for the days, and says how many cities, days and records', async () => {
      const cityCount = new Set((await listZones(await adminContext(), { limit: 200 })).items.map((z) => z.city_id)).size;
      const result = await recomputePrayer({ date_from: '2026-11-01', date_to: '2026-11-07' });
      expect(result).toMatchObject({ ok: true, data: { cities: cityCount, days: 7, records: cityCount * 7 } });
      const stored = (await listPrayerTimes(await adminContext(), { limit: 200 })).items.filter((p) => p.prayer_date >= '2026-11-01');
      expect(stored).toHaveLength(cityCount * 7);
      expect((await events('prayer_times.recomputed')).at(0)).toMatchObject({ outcome: 'success' });
    });

    it('refuses a range that is backwards or longer than 400 days, and is refused for a viewer (audited as denied)', async () => {
      for (const bad of [{ date_from: '2026-11-07', date_to: '2026-11-01' }, { date_from: '2026-01-01', date_to: '2027-12-31' }, { date_from: 'x', date_to: 'y' }, {}]) expect(await recomputePrayer(bad as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
      session.role = 'viewer_auditor';
      expect(await recomputePrayer({ date_from: '2026-11-01', date_to: '2026-11-07' })).toMatchObject({ ok: false, code: 'forbidden' });
      expect((await events('prayer_times.recomputed')).map((e) => e.outcome)).toEqual(['denied']);
    });
  });

  describe('savePolicy', () => {
    it('saves the notice, the share (a percent typed, a share kept) and the blackout periods, and audits it', async () => {
      expect(await savePolicy(policy)).toMatchObject({ ok: true, data: { saved: true } });
      expect(await getLeavePolicy(await adminContext())).toEqual({ min_notice_days: 10, max_concurrent_leave_share: 0.2, blackout_periods: [{ start_date: '2026-12-20', end_date: '2026-12-31', label_en: 'Year end' }] });
      expect((await events('leave_policy.updated')).at(0)?.outcome).toBe('success');
    });

    it.each([
      ['a notice above 365 days', { min_notice_days: 366 }],
      ['a negative notice', { min_notice_days: -1 }],
      ['a notice that is not whole', { min_notice_days: 2.5 }],
      ['a share above 100 percent', { share_percent: 101 }],
      ['a share that is not a number', { share_percent: 'a lot' }],
      ['a blackout that ends before it starts', { blackout_periods: [{ start_date: '2026-12-31', end_date: '2026-12-20', label_en: 'x' }] }],
      ['a blackout label over 120 characters', { blackout_periods: [{ start_date: '2026-12-20', end_date: '2026-12-31', label_en: 'x'.repeat(121) }] }],
      ['blackout periods that are not a list', { blackout_periods: 'none' }],
    ] as const)('refuses %s, with the data layer\'s English message, and saves nothing', async (_name, change) => {
      const result = await savePolicy({ ...policy, ...change } as never);
      expect(result).toMatchObject({ ok: false, code: 'invalid' });
      expect(await getLeavePolicy(await adminContext())).toMatchObject({ min_notice_days: 7, max_concurrent_leave_share: 0.15 });
    });

    it('is refused for a viewer and audited as denied', async () => {
      session.role = 'viewer_auditor';
      expect(await savePolicy(policy)).toMatchObject({ ok: false, code: 'forbidden' });
      expect((await events('leave_policy.updated')).map((e) => e.outcome)).toEqual(['denied']);
    });
  });

  describe('saveRange, removeRange and setPayday', () => {
    it('adds and changes a school term, removes it with its name for the toast, and audits each', async () => {
      const added = await saveRange({ kind: 'school', name: ' Term 9 ', start_date: '2027-08-22', end_date: '2027-11-25' });
      expect(added).toMatchObject({ ok: true, data: { name: 'Term 9', created: true } });
      if (!added.ok) return;
      const moved = await saveRange({ targetId: added.data.id, kind: 'school', name: 'Term 9', start_date: '2027-08-29', end_date: '2027-11-25' });
      expect(moved).toMatchObject({ ok: true, data: { created: false } });
      if (!moved.ok) return;
      expect(await saveRange({ kind: 'school', name: 'Clash', start_date: '2027-09-01', end_date: '2027-09-05' })).toMatchObject({ ok: false, code: 'conflict' });
      expect(await removeRange({ targetId: moved.data.id })).toMatchObject({ ok: true, data: { name: 'Term 9' } });
      expect(await removeRange({ targetId: moved.data.id })).toMatchObject({ ok: false, code: 'not_found' });
      expect((await events('calendar_event.created')).at(0)?.outcome).toBe('success');
      expect((await events('calendar_event.deleted')).at(0)?.outcome).toBe('success');
    });

    it('sets the payday day and turns it off, and refuses a day out of range', async () => {
      expect(await setPayday({ payday_day: 26 })).toMatchObject({ ok: true, data: { payday_day: 26 } });
      expect((await listCalendarEvents(await adminContext())).payday_day).toBe(26);
      expect(await setPayday({ payday_day: 32 })).toMatchObject({ ok: false, code: 'invalid' });
      expect(await setPayday({ payday_day: 0 })).toMatchObject({ ok: true, data: { payday_day: 0 } });
      expect(await setPayday({ payday_day: 27 })).toMatchObject({ ok: true });
    });

    it('is refused for a role that is not the Administrator, audited as denied', async () => {
      session.role = 'planner';
      expect(await saveRange({ kind: 'umrah', name: 'x', start_date: '2027-01-01', end_date: '2027-01-02' })).toMatchObject({ ok: false, code: 'forbidden' });
      expect(await setPayday({ payday_day: 3 })).toMatchObject({ ok: false, code: 'forbidden' });
      session.role = 'administrator';
      expect((await events('calendar_event.created')).map((e) => e.outcome)).toContain('denied');
      expect((await events('settings.payday_day_changed')).map((e) => e.outcome)).toContain('denied');
    });
  });

  describe('every action', () => {
    it('answers `unauthenticated` with no session, refuses input that is not an object, and leaks no input on an unexpected error', async () => {
      session.role = null;
      expect(await saveHoliday(newHoliday())).toMatchObject({ ok: false, code: 'unauthenticated' });
      session.role = 'administrator';
      for (const bad of [null, undefined, 'x', 42, [], {}]) expect(await saveHoliday(bad as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
      const hostile = new Proxy({}, {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2 name=secret-holiday');
        },
      });
      const result = await saveHoliday(hostile as never);
      expect(result).toMatchObject({ ok: false, code: 'unexpected' });
      if (result.ok) throw new Error('unreachable');
      expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
      expect(JSON.stringify(result) + errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|secret-holiday|boom/);
    });

    it('never forwards a field it does not name, and names the caller in the audit event whatever the input claims', async () => {
      const input = newHoliday();
      expect(await saveHoliday({ ...input, tenant_id: 'x', created_by: 'forged', actor_user_id: 'forged' } as never)).toMatchObject({ ok: true });
      expect(await holiday(input.name_en)).toMatchObject({ tenant_id: (await adminContext()).customerId });
      expect((await events('holiday.created'))[0]?.actor_user_id).toBe((await adminContext()).userId);
    });
  });

  describe('the server-built context rule in this file', () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
    const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

    it('is a use-server file whose exports are all async functions', () => {
      expect(source.trimStart().startsWith("'use server';")).toBe(true);
      const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
      expect([...new Set(exported)]).toEqual(['async']);
      expect(exported).toHaveLength(9);
    });

    it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
      const inputTypes = types.slice(types.indexOf('What the browser sends'));
      const fields = [...inputTypes.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
      expect(fields.length).toBeGreaterThan(10);
      for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
      for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
    });
  });
});
