// SPDX-License-Identifier: AGPL-3.0-only
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// RosterAssignment/Roster is api-backed (rosters.ts); Zone
// too (locations.ts). Oracles read via time.ts.

import { describe, expect, it } from 'vitest';
import type { Roster, RosterAssignment, Zone } from '@/lib/types';
import { listAuditEvents } from './audit';
import { ConflictError, DataError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { generateBreakPlan, getBreakPlan, isoAtMinute, updateBreakSlot } from './breaks';
import { buildRoster } from './rosters';
import { listBreakRules, listPrayerTimes, listShiftPatterns } from './time';
import { auditCount, ctxFor, dataSnapshot, expectValid, fixtureZoneIds, JUNK_IDS, readAll, withTempDemoState } from './test-support';
import { freshDate } from '../../../test/live-fixtures';

// Minutes from 00:00 of `date` (Riyadh).
function minutesOf(date: string, iso: string): number {
  return Math.round((Date.parse(iso) - Date.parse(`${date}T00:00:00+03:00`)) / 60_000);
}

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

describe.skipIf(!hasApi)('breaks (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: breaks.live.test.ts is skipped, not faked.');

  withTempDemoState();

  const [riyadhCentral, , , , , jeddahNorth] = fixtureZoneIds();
  const admin = () => ctxFor('administrator');
  const planner = () => ctxFor('planner'); // Reem: Riyadh Central, North, East
  const monday = '2026-09-14'; // Read-only fixture: no test below mutates it.
  const draftDay = '2026-09-15'; // Read-only here too: every use below throws before any write.

  async function breakRuleOf(shiftPatternId: string): Promise<{ readonly breakMinutes: number; readonly afterHours: number }> {
    const pattern = (await listShiftPatterns(admin(), { limit: 200 })).items.find((p) => p.id === shiftPatternId);
    const rule = (await listBreakRules(admin(), { limit: 200 })).items.find((r) => r.id === pattern?.break_rule_id);
    return { breakMinutes: rule?.break_minutes ?? 30, afterHours: rule?.after_consecutive_hours ?? 5 };
  }

  async function prayerMinutesFor(zoneId: string, date: string): Promise<{ readonly name: string; readonly minute: number }[]> {
    const zone = (await readAll<Zone>(planner().customerId, 'Zone')).find((z) => z.id === zoneId);
    if (zone === undefined) return [];
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const tomorrow = next.toISOString().slice(0, 10);
    const rows = (await listPrayerTimes(admin(), { city_id: zone.city_id, date_from: date, date_to: tomorrow, limit: 10 })).items;
    const at = (time: string, plusDay = 0): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + plusDay * 1440;
    const out: { name: string; minute: number }[] = [];
    const today = rows.find((r) => r.prayer_date === date);
    const after = rows.find((r) => r.prayer_date === tomorrow);
    if (today !== undefined) out.push({ name: 'fajr', minute: at(today.fajr) }, { name: 'dhuhr', minute: at(today.dhuhr) }, { name: 'asr', minute: at(today.asr) }, { name: 'maghrib', minute: at(today.maghrib) }, { name: 'isha', minute: at(today.isha) });
    if (after !== undefined) out.push({ name: 'fajr', minute: at(after.fajr, 1) });
    return out;
  }

  async function freshBuiltRoster(): Promise<{ readonly roster: Roster; readonly assignments: RosterAssignment[] }> {
    const roster = await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: freshDate(0) });
    const assignments = (await readAll<RosterAssignment>(planner().customerId, 'RosterAssignment')).filter((a) => a.roster_id === roster.id);
    return { roster, assignments };
  }

  describe('reading the break plan', () => {
    it('shows the breaks of a zone and day, and validates against the contract', async () => {
      const plan = await getBreakPlan(planner(), { zone_id: riyadhCentral, date: monday });
      expect(plan.slots.length).toBeGreaterThan(0);
      expect(plan.illustrative).toBe(true);
      expectValid('BreakPlan', plan);
      for (const slot of plan.slots) expect(Date.parse(slot.end_at) - Date.parse(slot.start_at)).toBe(30 * 60_000);
      expect((await getBreakPlan(planner(), { zone_id: riyadhCentral, date: '2026-12-25' })).slots).toEqual([]);
    });

    it('is visible to the roles with the module and keeps the zone scope', async () => {
      for (const role of ['administrator', 'dispatch_supervisor', 'planner', 'viewer_auditor'] as const) {
        await expect(getBreakPlan(ctxFor(role), { zone_id: riyadhCentral, date: monday })).resolves.toBeDefined();
      }
      for (const role of ['dispatcher', 'remote_team_lead', 'change_approver'] as const) {
        await expect(getBreakPlan(ctxFor(role), { zone_id: riyadhCentral, date: monday })).rejects.toThrow(ForbiddenError);
      }
      await expect(getBreakPlan(planner(), { zone_id: jeddahNorth, date: monday })).rejects.toThrow(NotFoundError);
      await expect(getBreakPlan(planner(), { date: monday })).rejects.toThrow(InvalidInputError);
    });
  });

  describe('generating and adjusting the plan', () => {
    it('places prayer-aware breaks by the rule and audits it', async () => {
      const { roster } = await freshBuiltRoster();
      const date = roster.roster_date;
      const plan = await generateBreakPlan(planner(), { zone_id: riyadhCentral, roster_date: date });
      expect(plan.slots.length).toBeGreaterThan(10);
      expectValid('BreakPlan', plan);
      const after = (await readAll<RosterAssignment>(planner().customerId, 'RosterAssignment')).filter((a) => a.roster_id === roster.id);
      for (const a of after) {
        if (a.break_start_at === null || a.break_start_at === undefined) continue;
        const rule = await breakRuleOf(a.shift_pattern_id);
        const start = minutesOf(date, a.break_start_at);
        const end = minutesOf(date, a.break_end_at ?? '');
        expect(start).toBeGreaterThanOrEqual(minutesOf(date, a.start_at) + rule.afterHours * 60);
        expect(end).toBeLessThanOrEqual(minutesOf(date, a.end_at));
        expect(end - start).toBe(rule.breakMinutes);
      }
      const audit = (await listAuditEvents(admin(), { action: 'break.plan_generated' })).items;
      expect(audit[0]).toMatchObject({ outcome: 'success', entity_type: 'roster' });
    });

    it('moves one break, flags a prayer conflict and refuses breaks the rule does not allow', async () => {
      const { roster, assignments } = await freshBuiltRoster();
      const date = roster.roster_date;
      const a = assignments.find((x) => x.break_start_at !== null && x.break_start_at !== undefined);
      expect(a).toBeDefined();
      if (a === undefined) throw new Error('unreachable');
      const rule = await breakRuleOf(a.shift_pattern_id);
      const shiftStart = minutesOf(date, a.start_at);
      const shiftEnd = minutesOf(date, a.end_at);
      const earliest = Math.ceil((shiftStart + rule.afterHours * 60) / 15) * 15;
      const latest = Math.floor((shiftEnd - rule.breakMinutes) / 15) * 15;
      const moved = await updateBreakSlot(planner(), a.id, { start_at: isoAtMinute(date, earliest) });
      expect(moved.start_at).toBe(isoAtMinute(date, earliest));
      expect(moved.end_at).toBe(isoAtMinute(date, earliest + rule.breakMinutes));
      // Go's prayer conflict, on real prayer times.
      const prayers = await prayerMinutesFor(riyadhCentral ?? '', date);
      const conflict = prayers.find((p) => p.minute - 10 >= earliest && p.minute - 10 <= latest);
      if (conflict !== undefined) {
        const cut = await updateBreakSlot(planner(), a.id, { start_at: isoAtMinute(date, Math.floor((conflict.minute - 10) / 15) * 15) });
        expect(cut.prayer_conflict).toBe(conflict.name);
      }
      await expect(updateBreakSlot(planner(), a.id, { start_at: isoAtMinute(date, earliest - 15) })).rejects.toThrow(InvalidInputError); // before the rule's hours
      await expect(updateBreakSlot(planner(), a.id, { start_at: isoAtMinute(date, latest + 15) })).rejects.toThrow(InvalidInputError); // past the shift end
      await expect(updateBreakSlot(planner(), a.id, { start_at: isoAtMinute(date, earliest + 5) })).rejects.toThrow(InvalidInputError); // off the grid
      await expect(updateBreakSlot(planner(), 'f0f0f0f0-0000-4000-8000-000000000000', { start_at: isoAtMinute(date, earliest) })).rejects.toThrow(NotFoundError);
    });

    it('refuses a roster that is published and a missing roster', async () => {
      const published = (await readAll<Roster>(planner().customerId, 'Roster')).find((r) => r.zone_id === riyadhCentral && r.status === 'published');
      expect(published).toBeDefined();
      await expect(generateBreakPlan(planner(), { zone_id: riyadhCentral, roster_date: published?.roster_date })).rejects.toThrow(ConflictError);
      await expect(generateBreakPlan(planner(), { zone_id: riyadhCentral, roster_date: '2027-01-01' })).rejects.toThrow(NotFoundError);
      await expect(generateBreakPlan(planner(), { zone_id: riyadhCentral, roster_date: 'soon' })).rejects.toThrow(InvalidInputError);
    });

    it('refuses a role without edit and a zone outside the scope, and audits each denial', async () => {
      for (const role of ['dispatch_supervisor', 'viewer_auditor', 'administrator'] as const) {
        await expect(generateBreakPlan(ctxFor(role), { zone_id: riyadhCentral, roster_date: draftDay })).rejects.toThrow(ForbiddenError);
      }
      await expect(generateBreakPlan(planner(), { zone_id: jeddahNorth, roster_date: draftDay })).rejects.toThrow(ForbiddenError);
      const denied = (await listAuditEvents(admin(), { action: 'break.plan_generated', outcome: 'denied' })).items;
      expect(denied.length).toBeGreaterThanOrEqual(4);
    });

    it('refuses a break change on a remote assignment or in another zone for a zone-limited planner', async () => {
      // The api's own timestamps aren't ISO (no "T"): recompute
      // a well-formed one instead of resubmitting a raw value.
      const isoOf = (a: RosterAssignment): string => isoAtMinute(a.roster_date, minutesOf(a.roster_date, a.break_start_at ?? a.start_at));
      const remote = (await readAll<RosterAssignment>(planner().customerId, 'RosterAssignment')).find((a) => a.zone_id === null && a.break_start_at !== null && a.break_start_at !== undefined);
      expect(remote).toBeDefined();
      if (remote === undefined) throw new Error('unreachable');
      await expect(updateBreakSlot(planner(), remote.id, { start_at: isoOf(remote) })).rejects.toThrow(ForbiddenError);
      const jeddah = (await readAll<RosterAssignment>(planner().customerId, 'RosterAssignment')).find((a) => a.zone_id === jeddahNorth);
      expect(jeddah).toBeDefined();
      if (jeddah === undefined) throw new Error('unreachable');
      await expect(updateBreakSlot(planner(), jeddah.id, { start_at: isoOf(jeddah) })).rejects.toThrow(ForbiddenError);
      const own = (await readAll<RosterAssignment>(planner().customerId, 'RosterAssignment')).find((a) => a.zone_id === riyadhCentral);
      expect(own).toBeDefined();
      if (own === undefined) throw new Error('unreachable');
      await expect(updateBreakSlot(ctxFor('viewer_auditor'), own.id, { start_at: isoOf(own) })).rejects.toThrow(ForbiddenError);
    });
  });

  describe('crafted ids (review M4) and guard order (review m2)', () => {
    function codeOfError(error: unknown): string {
      return error instanceof DataError ? error.code : `not a DataError: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
    }

    async function expectJunkIdsInvalidLive(call: (id: never) => Promise<unknown>, ids: readonly unknown[] = JUNK_IDS): Promise<void> {
      const before = dataSnapshot();
      const audits = await auditCount();
      for (const id of ids) {
        let code = 'did not throw';
        try {
          await call(id as never);
        } catch (error) {
          code = codeOfError(error);
        }
        expect(code, `id ${JSON.stringify(id) ?? String(id)}`).toBe('invalid');
      }
      expect(dataSnapshot()).toBe(before);
      expect(await auditCount()).toBe(audits);
    }

    async function expectJunkIdsForbiddenLive(call: (id: never) => Promise<unknown>, ids: readonly unknown[] = JUNK_IDS): Promise<void> {
      const before = dataSnapshot();
      const audits = await auditCount();
      for (const id of ids) {
        let code = 'did not throw';
        try {
          await call(id as never);
        } catch (error) {
          code = codeOfError(error);
        }
        expect(code, `id ${JSON.stringify(id) ?? String(id)}`).toBe('forbidden');
      }
      expect(dataSnapshot()).toBe(before);
      expect(await auditCount()).toBe(audits + ids.length);
    }

    it('refuses a crafted assignment or zone id up front and changes nothing', async () => {
      await expectJunkIdsInvalidLive((id) => updateBreakSlot(planner(), id, { start_at: `${draftDay}T12:00:00+03:00` }));
      await expectJunkIdsInvalidLive((id) => getBreakPlan(planner(), { zone_id: id, date: draftDay }));
    });

    it('answers forbidden and audits the denial for a caller who may not write, whatever the id or the body', async () => {
      await expectJunkIdsForbiddenLive((id) => updateBreakSlot(ctxFor('viewer_auditor'), id, { nonsense: true }));
      await expect(generateBreakPlan(ctxFor('viewer_auditor'), 'not an object')).rejects.toThrow(ForbiddenError);
      const denied = (await listAuditEvents(admin(), { action: 'break.plan_generated', outcome: 'denied' })).items;
      expect(denied.length).toBeGreaterThanOrEqual(1);
    });
  });
});
