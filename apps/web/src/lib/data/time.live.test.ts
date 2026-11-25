// SPDX-License-Identifier: AGPL-3.0-only
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// No delete op for shift patterns/break rules: left in Postgres under this run's own codes.

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit';
import { ConflictError, ForbiddenError, InvalidInputError } from './errors';
import { createBreakRule, createCalendarEvent, createHoliday, createShiftPattern, deleteCalendarEvent, deleteHoliday, getShiftPattern, listBreakRules, listCalendarEvents, listHolidays, listShiftPatterns, updateBreakRule, updateCalendarEvent, updateHoliday, updatePaydayDay, updateShiftPattern } from './time';
import { ctxFor, expectValid } from './test-support';

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
const randomCode = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;

describe.skipIf(!hasApi)('time (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: time.live.test.ts is skipped, not faked.');

  const admin = () => ctxFor('administrator');

  describe('shift patterns and break rules', () => {
    it('lists the seeded fixtures and validates against the contract', async () => {
      const shifts = await listShiftPatterns(admin());
      expect(shifts.items.length).toBeGreaterThanOrEqual(6);
      expectValid('ShiftPatternList', shifts);
      expectValid('ShiftPattern', await getShiftPattern(admin(), shifts.items[0]!.id));
      const breaks = await listBreakRules(admin());
      expect(breaks.items.length).toBeGreaterThanOrEqual(2);
      expectValid('BreakRuleList', breaks);
    });

    it('is readable by every role except Change Approver', async () => {
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor'] as const) expect((await listShiftPatterns(ctxFor(role))).items.length).toBeGreaterThan(0);
      await expect(listShiftPatterns(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
    });

    it('creates a draft pattern, derives crosses_midnight, and audits it', async () => {
      const rule = (await listBreakRules(admin())).items[0]!;
      const code = randomCode('DAY');
      const created = await createShiftPattern(admin(), {
        code,
        name_en: 'Live Day',
        kind: 'field',
        normal: { applies: true, start_time: '20:00', end_time: '04:00' },
        ramadan: { applies: true, start_time: '18:00', end_time: '00:00' },
        break_rule_id: rule.id,
      });
      expectValid('ShiftPattern', created);
      expect(created.status).toBe('draft');
      expect(created.normal.crosses_midnight).toBe(true);
      expect(created.ramadan.crosses_midnight).toBe(false);
      expect((await listAuditEvents(admin(), { action: 'shift_pattern.created' })).items.length).toBeGreaterThanOrEqual(1);
      const body = { code, name_en: 'Live Day late', kind: 'field', normal: { applies: true, start_time: '20:00', end_time: '04:00' }, ramadan: { applies: false }, break_rule_id: rule.id, status: 'active' };
      const updated = await updateShiftPattern(admin(), created.id, body);
      expect(updated).toMatchObject({ id: created.id, name_en: 'Live Day late', status: 'active' });
      await expect(createShiftPattern(admin(), body)).rejects.toThrow(ConflictError);
    });

    it('refuses invalid shift and break input and other roles', async () => {
      const rule = (await listBreakRules(admin())).items[0]!;
      await expect(createShiftPattern(admin(), { code: randomCode('BAD'), name_en: 'X', kind: 'field', normal: { applies: true, start_time: '25:00', end_time: '04:00' }, ramadan: { applies: false }, break_rule_id: rule.id })).rejects.toThrow(InvalidInputError);
      await expect(createBreakRule(admin(), { code: randomCode('BRK'), name_en: 'B', break_minutes: 30, after_consecutive_hours: 0 })).rejects.toThrow(InvalidInputError);
      await expect(createBreakRule(ctxFor('planner'), { code: randomCode('BRK'), name_en: 'B', break_minutes: 30, after_consecutive_hours: 5 })).rejects.toThrow(ForbiddenError);
      const made = await createBreakRule(admin(), { code: randomCode('BRK'), name_en: 'B', break_minutes: 20, after_consecutive_hours: 4.5 });
      expect((await updateBreakRule(admin(), made.id, { code: made.code, name_en: 'B2', break_minutes: 25, after_consecutive_hours: 4.5 })).break_minutes).toBe(25);
    });
  });

  describe('holidays', () => {
    it('lists the seeded holidays with Hijri dates and filters by range', async () => {
      const all = await listHolidays(admin());
      expectValid('HolidayList', all);
      expect(all.items.length).toBeGreaterThanOrEqual(7);
      const eid = await listHolidays(admin(), { date_from: '2026-03-20', date_to: '2026-03-22' });
      expect(eid.items.map((h) => h.name_en)).toContain('Eid al-Fitr');
    });

    it('creates, updates and deletes a holiday with its Hijri dates, audited', async () => {
      const created = await createHoliday(admin(), { name_en: 'Live Company day', start_date: '2026-10-01', end_date: '2026-10-02', kind: 'observance' });
      expectValid('Holiday', created);
      expect(created.hijri_start).toEqual({ year: 1448, month: 4, day: 20 });
      expect((await updateHoliday(admin(), created.id, { name_en: 'Live Company days', start_date: '2026-10-01', end_date: '2026-10-03', kind: 'observance' })).end_date).toBe('2026-10-03');
      await expect(createHoliday(admin(), { name_en: 'Bad', start_date: '2026-10-05', end_date: '2026-10-01', kind: 'public' })).rejects.toThrow(InvalidInputError);
      await deleteHoliday(admin(), created.id);
      expect((await listHolidays(admin())).items.find((h) => h.id === created.id)).toBeUndefined();
      const actions = (await listAuditEvents(admin(), { entity_id: created.id })).items.map((e) => e.action).sort();
      expect(actions).toEqual(['holiday.created', 'holiday.deleted', 'holiday.updated']);
      await expect(createHoliday(ctxFor('viewer_auditor'), { name_en: 'x', start_date: '2026-10-01', end_date: '2026-10-01', kind: 'public' })).rejects.toThrow(ForbiddenError);
    });

    it('takes a null name_ar (a holiday with no Arabic name)', async () => {
      const created = await createHoliday(admin(), { name_en: 'Live No Arabic', name_ar: null, start_date: '2026-10-10', end_date: '2026-10-10', kind: 'observance' });
      expect(created.name_ar).toBeNull();
      await deleteHoliday(admin(), created.id);
    });
  });

  describe('calendar events (the Events tab)', () => {
    it('lists the payday day and the derived events, with no operator calendar configured', async () => {
      const read = await listCalendarEvents(admin(), { from: '2026-01-01', to: '2026-12-31' });
      expectValid('CalendarEvents', read);
      expect(read.payday_day).toBe(27);
      const national = read.items.find((e) => e.kind === 'derived' && e.name === 'National Day');
      expect(national).toMatchObject({ start_date: '2026-09-23', source: 'fixed', editable: false, scope: { cities: [], region: null } });
      await expect(listCalendarEvents(admin(), { from: '2026-01-01', to: '2028-01-01' })).rejects.toThrow(InvalidInputError);
    });

    it('adds, changes and removes a range set here, refuses an overlap, and audits each write', async () => {
      const term = await createCalendarEvent(admin(), { kind: 'school', name: 'Live term', start_date: '2027-01-10', end_date: '2027-03-01' });
      expectValid('CalendarEvent', term);
      expect(term).toMatchObject({ kind: 'school', source: 'setting', editable: true });
      await expect(createCalendarEvent(admin(), { kind: 'school', name: 'Clash', start_date: '2027-02-01', end_date: '2027-02-10' })).rejects.toThrow(ConflictError);
      const moved = await updateCalendarEvent(admin(), term.id, { kind: 'school', name: 'Live term', start_date: '2027-01-17', end_date: '2027-03-01' });
      expect(moved.id).not.toBe(term.id);
      expect((await listCalendarEvents(admin())).items.filter((e) => e.kind === 'school').map((e) => e.start_date)).toEqual(['2027-01-17']);
      await deleteCalendarEvent(admin(), moved.id);
      expect((await listCalendarEvents(admin())).items.filter((e) => e.kind === 'school')).toEqual([]);
      const actions = (await listAuditEvents(admin(), { limit: 50 })).items.map((e) => `${e.action}:${e.outcome}`);
      for (const a of ['calendar_event.created:success', 'calendar_event.updated:success', 'calendar_event.deleted:success']) expect(actions).toContain(a);
    });

    it('sets and removes the payday day', async () => {
      expect(await updatePaydayDay(admin(), { payday_day: 25 })).toEqual({ payday_day: 25 });
      expect((await listCalendarEvents(admin())).payday_day).toBe(25);
      await updatePaydayDay(admin(), { payday_day: 0 });
      expect((await listCalendarEvents(admin())).payday_day).toBe(0);
      await expect(updatePaydayDay(admin(), { payday_day: 40 })).rejects.toThrow(InvalidInputError);
      await updatePaydayDay(admin(), { payday_day: 27 });
    });

    it('is the Administrator\'s: the other roles may not read or write it, and a denied write is audited', async () => {
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead'] as const) {
        await expect(listCalendarEvents(ctxFor(role))).rejects.toThrow(ForbiddenError);
        await expect(createCalendarEvent(ctxFor(role), { kind: 'season', name: 'x', start_date: '2027-01-01', end_date: '2027-01-02' })).rejects.toThrow(ForbiddenError);
        await expect(updatePaydayDay(ctxFor(role), { payday_day: 1 })).rejects.toThrow(ForbiddenError);
      }
      expect((await listAuditEvents(admin(), { action: 'settings.payday_day_changed', outcome: 'denied', limit: 50 })).items.length).toBeGreaterThanOrEqual(4);
    });
  });
});
