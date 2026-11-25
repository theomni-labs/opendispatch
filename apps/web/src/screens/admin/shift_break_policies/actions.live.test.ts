// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { createBreakRule, listBreakRules, listShiftPatterns, updateShiftPattern } from '@/lib/data/time';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { saveBreakRule, savePattern, savePrayerPolicy, setPatternsStatus } from './actions';
import { getSettingsSnapshot } from '@/lib/data/settings';
import type { SavePatternInput } from './types';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Shift patterns/break rules are real Postgres, shared: codes are randomized per call.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
const randomCode = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;

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
const patterns = async () => (await listShiftPatterns(await adminContext(), { limit: 200 })).items;
const pattern = async (code: string) => (await patterns()).find((p) => p.code === code)!;
const breaks = async () => (await listBreakRules(await adminContext(), { limit: 200 })).items;
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;

// A fresh code every call: Postgres is shared and not reset between tests, unlike the demo store above.
const newPattern = async (): Promise<SavePatternInput> => ({
  name_en: 'Live Day',
  code: randomCode('DAY'),
  kind: 'field',
  normal: { applies: true, start_time: '08:00', end_time: '16:00' },
  ramadan: { applies: true, start_time: '08:00', end_time: '14:00' },
  break_rule_id: (await breaks())[0]!.id,
  status: 'draft',
});

describe.skipIf(!hasApi)('shift_break_policies actions (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

  describe('savePattern', () => {
    it('adds a pattern as a draft with its hours, audits it, and refreshes the page in both languages', async () => {
      const input = await newPattern();
      expect(await savePattern(input)).toMatchObject({ ok: true, data: { code: input.code, created: true, status: 'draft' } });
      expect(await pattern(input.code)).toMatchObject({ name_en: 'Live Day', kind: 'field', status: 'draft', normal: { applies: true, start_time: '08:00', end_time: '16:00', crosses_midnight: false }, ramadan: { start_time: '08:00', end_time: '14:00' } });
      expect((await events('shift_pattern.created')).at(0)).toMatchObject({ outcome: 'success' });
      expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/shift-break-policies', '/ar/admin/shift-break-policies']);
    });

    it('adds a pattern that does not run in Ramadan, and one that crosses midnight (derived, never sent)', async () => {
      const code = randomCode('NIGHT');
      expect(await savePattern({ ...(await newPattern()), code, ramadan: { applies: false, start_time: '', end_time: '' }, normal: { applies: true, start_time: '22:00', end_time: '06:00' } })).toMatchObject({ ok: true });
      expect(await pattern(code)).toMatchObject({ ramadan: { applies: false }, normal: { crosses_midnight: true } });
    });

    it('changes a pattern keeping its code, its Arabic name and `extra` (the assumption note), and does not let the browser change the code', async () => {
      // DAY-A is a real fixture other live files read: restore it, never leave it renamed.
      const before = await pattern('DAY-A');
      expect(before.extra).toMatchObject({ assumption: true });
      try {
        const result = await savePattern({ ...(await newPattern()), targetId: before.id, name_en: 'Day A renamed', code: 'HACKED', kind: 'field', normal: { applies: true, start_time: '07:00', end_time: '15:00' }, break_rule_id: before.break_rule_id, status: 'active' });
        expect(result).toMatchObject({ ok: true, data: { created: false, code: 'DAY-A' } });
        const after = await pattern('DAY-A');
        expect(after).toMatchObject({ id: before.id, name_en: 'Day A renamed', normal: { start_time: '07:00', end_time: '15:00' }, extra: before.extra });
        expect((await events('shift_pattern.updated')).at(0)?.outcome).toBe('success');
      } finally {
        await updateShiftPattern(await adminContext(), before.id, {
          code: before.code,
          name_en: before.name_en,
          name_ar: before.name_ar,
          kind: before.kind,
          normal: { applies: before.normal.applies, start_time: before.normal.start_time, end_time: before.normal.end_time },
          ramadan: { applies: before.ramadan.applies, start_time: before.ramadan.start_time, end_time: before.ramadan.end_time },
          break_rule_id: before.break_rule_id,
          status: before.status,
        });
      }
    });

    it.each([
      ['a code that is used', { code: 'DAY-A' }, 'conflict'],
      ['an empty name', { name_en: '' }, 'invalid'],
      ['a kind that is not one', { kind: 'hybrid' }, 'invalid'],
      ['equal start and end', { normal: { applies: true, start_time: '08:00', end_time: '08:00' } }, 'invalid'],
      ['a time that is not a time', { normal: { applies: true, start_time: '8am', end_time: '16:00' } }, 'invalid'],
      ['a break rule that does not exist', { break_rule_id: '00000000-0000-4000-8000-00000000dead' }, 'not_found'],
      ['a status that is not one', { status: 'live' }, 'invalid'],
    ] as const)('refuses %s, with the data layer\'s English message, and adds nothing', async (_name, change, code) => {
      const before = (await patterns()).length;
      const result = await savePattern({ ...(await newPattern()), ...change } as never);
      expect(result).toMatchObject({ ok: false, code });
      if (!result.ok) expect(result.message).toMatch(/[A-Za-z]/);
      expect((await patterns()).length).toBe(before);
    });

    it('answers `not_found` for a pattern that does not exist and `invalid` for an id that is not one', async () => {
      expect(await savePattern({ ...(await newPattern()), targetId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
      for (const bad of ['toString', '__proto__', '../etc']) expect(await savePattern({ ...(await newPattern()), targetId: bad }), bad).toMatchObject({ ok: false, code: 'invalid' });
    });

    it('is refused for every role that is not an Administrator, adding and changing, audited as denied', async () => {
      const one = await pattern('DAY-A');
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
        session.role = role;
        expect(await savePattern(await newPattern()), `${role} adds`).toMatchObject({ ok: false, code: 'forbidden' });
        expect(await savePattern({ ...(await newPattern()), targetId: one.id }), `${role} changes`).toMatchObject({ ok: false, code: 'forbidden' });
      }
      expect((await events('shift_pattern.created')).length + (await events('shift_pattern.updated')).length).toBe(12);
      expect([...(await events('shift_pattern.created')), ...(await events('shift_pattern.updated'))].every((e) => e.outcome === 'denied')).toBe(true);
      expect(await pattern('DAY-A')).toMatchObject({ name_en: 'Day A' });
    });
  });

  describe('setPatternsStatus (the bulk bar: one data call per pattern)', () => {
    it('sets the patterns to draft and back to active, keeping their hours, and counts what was already so', async () => {
      // By code: other runs may reorder patterns.
      const targets = (await patterns()).filter((p) => ['DAY-A', 'DAY-B', 'EVENING'].includes(p.code));
      expect(targets).toHaveLength(3);
      const ids = targets.map((p) => p.id);
      expect(await setPatternsStatus({ targetIds: ids, status: 'draft' })).toMatchObject({ ok: true, data: { changed: 3, failed: 0, status: 'draft' } });
      const drafted = await patterns();
      expect(ids.every((id) => drafted.find((p) => p.id === id)?.status === 'draft')).toBe(true);
      expect(drafted.find((p) => p.code === 'DAY-A')).toMatchObject({ normal: { start_time: '06:00', end_time: '14:00' }, extra: { assumption: true } });
      expect(await setPatternsStatus({ targetIds: ids, status: 'draft' })).toMatchObject({ ok: true, data: { changed: 0 } });
      expect(await setPatternsStatus({ targetIds: ids, status: 'active' })).toMatchObject({ ok: true, data: { changed: 3 } });
      expect((await events('shift_pattern.updated')).filter((e) => e.outcome === 'success')).toHaveLength(6);
    });

    it('counts a pattern that does not exist, refuses a bad status or list, and stops for a viewer with one denied event', async () => {
      const id = (await patterns()).find((p) => p.code === 'DAY-A')!.id;
      expect(await setPatternsStatus({ targetIds: [id, '00000000-0000-4000-8000-00000000dead'], status: 'draft' })).toMatchObject({ ok: true, data: { changed: 1, failed: 1 } });
      for (const bad of [{ targetIds: [], status: 'draft' }, { targetIds: [id], status: 'live' }, { targetIds: [1], status: 'draft' }, { targetIds: Array.from({ length: 101 }, (_, i) => String(i)), status: 'draft' }]) expect(await setPatternsStatus(bad as never), JSON.stringify(bad).slice(0, 30)).toMatchObject({ ok: false, code: 'invalid' });
      session.role = 'viewer_auditor';
      expect(await setPatternsStatus({ targetIds: (await patterns()).map((p) => p.id), status: 'draft' })).toMatchObject({ ok: false, code: 'forbidden' });
      expect((await events('shift_pattern.updated')).filter((e) => e.outcome === 'denied')).toHaveLength(1);
      // Restore: the id above must end active, whatever bulk calls ran on it too.
      const current = (await patterns()).find((p) => p.id === id)!;
      if (current.status !== 'active') {
        await updateShiftPattern(await adminContext(), id, {
          code: current.code,
          name_en: current.name_en,
          name_ar: current.name_ar,
          kind: current.kind,
          normal: { applies: current.normal.applies, start_time: current.normal.start_time, end_time: current.normal.end_time },
          ramadan: { applies: current.ramadan.applies, start_time: current.ramadan.start_time, end_time: current.ramadan.end_time },
          break_rule_id: current.break_rule_id,
          status: 'active',
        });
      }
    });
  });

  describe('saveBreakRule', () => {
    // A disposable rule: saveBreakRule has no create path, but BRK-STD is a
    // real fixture other live files read, so it must not be left changed.
    const disposableRule = async () => createBreakRule(await adminContext(), { code: randomCode('BRK'), name_en: 'Live Break', name_ar: 'استراحة اختبار', break_minutes: 30, after_consecutive_hours: 5 });

    it('changes the minutes and the hours, keeping the code and the name, and audits it', async () => {
      const rule = await disposableRule();
      expect(await saveBreakRule({ targetId: rule.id, break_minutes: 45, after_consecutive_hours: 4 })).toMatchObject({ ok: true, data: { code: rule.code } });
      expect((await breaks()).find((b) => b.id === rule.id)).toMatchObject({ code: rule.code, name_en: rule.name_en, break_minutes: 45, after_consecutive_hours: 4 });
      expect((await events('break_rule.updated')).at(0)?.outcome).toBe('success');
    });

    it('refuses minutes and hours out of range, a rule that does not exist, and a viewer (audited as denied)', async () => {
      const rule = await disposableRule();
      for (const bad of [{ break_minutes: 0 }, { break_minutes: 181 }, { break_minutes: 10.5 }, { after_consecutive_hours: 0 }, { after_consecutive_hours: 13 }, { after_consecutive_hours: 'five' }]) expect(await saveBreakRule({ targetId: rule.id, break_minutes: 30, after_consecutive_hours: 5, ...bad } as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
      expect(await saveBreakRule({ targetId: '00000000-0000-4000-8000-00000000dead', break_minutes: 30, after_consecutive_hours: 5 })).toMatchObject({ ok: false, code: 'not_found' });
      session.role = 'viewer_auditor';
      expect(await saveBreakRule({ targetId: rule.id, break_minutes: 45, after_consecutive_hours: 5 })).toMatchObject({ ok: false, code: 'forbidden' });
      expect((await events('break_rule.updated')).map((e) => e.outcome)).toContain('denied');
      expect((await breaks()).find((b) => b.id === rule.id)?.break_minutes).toBe(30);
    });
  });

  describe('savePrayerPolicy', () => {
    it('sets how breaks meet prayer and the window, audited; refuses bad values and a planner', async () => {
      expect(await savePrayerPolicy({ prayer_policy: 'lined_up_with_prayer' })).toMatchObject({ ok: true, data: { mode: 'lined_up_with_prayer', windowMinutes: 30 } });
      expect(await savePrayerPolicy({ prayer_window_minutes: 45 })).toMatchObject({ ok: true, data: { mode: 'lined_up_with_prayer', windowMinutes: 45 } });
      expect(await getSettingsSnapshot(await adminContext())).toMatchObject({ break_prayer_policy: 'lined_up_with_prayer', prayer_window_minutes: 45 });
      expect((await events('settings.break_prayer_changed')).map((e) => e.outcome)).toEqual(['success', 'success']);
      for (const bad of [{ prayer_policy: 'whenever' }, { prayer_window_minutes: 4 }, { prayer_window_minutes: 95 }, {}]) expect(await savePrayerPolicy(bad as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
      session.role = 'planner';
      expect(await savePrayerPolicy({ prayer_policy: 'clear_of_prayer' })).toMatchObject({ ok: false, code: 'forbidden' });
      session.role = 'administrator';
      expect(await savePrayerPolicy({ prayer_policy: 'clear_of_prayer', prayer_window_minutes: 30 })).toMatchObject({ ok: true });
    });
  });

  describe('every action', () => {
    it('answers `unauthenticated` with no session, refuses input that is not an object, and leaks no input on an unexpected error', async () => {
      session.role = null;
      expect(await savePattern(await newPattern())).toMatchObject({ ok: false, code: 'unauthenticated' });
      session.role = 'administrator';
      for (const bad of [null, undefined, 'x', 42, [], {}]) expect(await savePattern(bad as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
      const hostile = new Proxy({}, {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2 name=secret-shift');
        },
      });
      const result = await savePattern(hostile as never);
      expect(result).toMatchObject({ ok: false, code: 'unexpected' });
      if (result.ok) throw new Error('unreachable');
      expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
      expect(JSON.stringify(result) + errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|secret-shift|boom/);
    });

    it('never forwards a field it does not name, and names the caller in the audit event whatever the input claims', async () => {
      const input = await newPattern();
      expect(await savePattern({ ...input, tenant_id: 'x', created_by: 'forged', actor_user_id: 'forged', extra: { admin: true } } as never)).toMatchObject({ ok: true });
      const created = await pattern(input.code);
      expect(created).toMatchObject({ tenant_id: (await adminContext()).customerId, extra: {} });
      expect((await events('shift_pattern.created'))[0]?.actor_user_id).toBe((await adminContext()).userId);
    });
  });

  describe('the server-built context rule in this file', () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
    const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

    it('is a use-server file whose exports are all async functions', () => {
      expect(source.trimStart().startsWith("'use server';")).toBe(true);
      const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
      expect([...new Set(exported)]).toEqual(['async']);
      expect(exported).toHaveLength(4);
    });

    it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
      const inputTypes = types.slice(types.indexOf('What the browser sends'));
      const fields = [...inputTypes.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
      expect(fields.length).toBeGreaterThan(12);
      for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
      for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
    });
  });
});
