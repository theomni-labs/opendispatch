// SPDX-License-Identifier: AGPL-3.0-only
// Break Planner view model (server only)

import { addDays } from '@/lib/day';
import { dateBoth, time } from '@opendispatch/ui/format';
import { getBreakPlan } from '@/lib/data/breaks';
import { listZones } from '@/lib/data/locations';
import { listAgents } from '@/lib/data/people';
import { listRosterAssignments, listRosters } from '@/lib/data/rosters';
import type { RequestContext } from '@/lib/data/guard';
import { getDemoToday } from '@/lib/data/settings';
import { listBreakRules, listPrayerTimes, listShiftPatterns } from '@/lib/data/time';
import type { BreakCoverageCost, BreakRule, DataSource, Roster, RosterAssignment, ShiftPattern, Agent, Zone } from '@/lib/types';
import type { RosterBlock, RosterRow } from '@/components/opendispatch/RosterGrid';
import { DEFAULT_PRAYER_POLICY, GRID, holdsWholePrayer, overlapMinutesOf, prayerConflictOf, type BreakPrayerPolicy, type PrayerMinute, type PrayerName } from './types';

// Statuses whose breaks may change (display)
const EDITABLE_STATUSES: readonly Roster['status'][] = ['draft', 'rejected', 'submitted', 'approved'];
// Most actionable first, Field Planner's order.
const ACTIONABLE_ORDER: readonly Roster['status'][] = ['submitted', 'draft', 'rejected', 'approved', 'building', 'published', 'superseded'];

export interface PickerOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface BreakRowView {
  readonly assignmentId: string;
  readonly agentName: string;
  readonly agentCode: string;
  readonly shiftLabel: string;
  readonly startMin: number;
  readonly endMin: number;
  readonly durationMin: number;
  readonly earliestMin: number;
  readonly latestMin: number;
  readonly prayerConflict: PrayerName | null;
  readonly holds: boolean;
  readonly overlapMinutes: number;
}

/** One shift sub-tab: its pattern and window. */
export interface ShiftGroupView {
  readonly id: string;
  readonly label: string;
  /** Minutes from the roster day's midnight. */
  readonly startMin: number;
  readonly endMin: number;
  readonly rowIds: readonly string[];
}

export interface BreakStatsView {
  readonly breaks: number;
  readonly conflicts: number;
  readonly holds: number;
  readonly peak: number;
}

export interface BreakRosterView {
  readonly id: string;
  readonly status: Roster['status'];
  readonly editable: boolean;
  // The day's own 5 prayers: the ribbon, chips.
  readonly prayerChips: readonly PrayerMinute[];
  // Plus next day's Fajr, for the preview
  readonly prayers: readonly PrayerMinute[];
  readonly stats: BreakStatsView;
  // Spec 4.5: demand the breaks leave uncovered.
  readonly coverageCost: BreakCoverageCost | undefined;
  readonly gridRows: readonly RosterRow[];
  readonly shifts: readonly ShiftGroupView[];
  readonly rows: readonly BreakRowView[];
  readonly conflictRows: readonly BreakRowView[];
  /** The prayer policy the plan used. */
  readonly policy: BreakPrayerPolicy;
}

export interface BreakPlannerView {
  readonly zone: PickerOption;
  readonly zoneOptions: readonly PickerOption[];
  readonly date: string;
  readonly dateLabel: string;
  readonly prevDate: string;
  readonly nextDate: string;
  readonly sources: readonly DataSource[];
  readonly roster: BreakRosterView | undefined;
}

// Small pure helpers


function zoneCode(zone: Zone): string {
  return typeof zone.extra?.['code'] === 'string' ? zone.extra['code'] : zone.id;
}

function pickerOf(zone: Zone): PickerOption {
  return { id: zone.id, code: zoneCode(zone), name: zone.name_en };
}

function localizedName(record: { readonly name_en: string; readonly name_ar?: string | null | undefined }, locale: 'en' | 'ar'): string {
  return locale === 'ar' && record.name_ar !== null && record.name_ar !== undefined && record.name_ar.trim() !== '' ? record.name_ar : record.name_en;
}

// Minutes from the roster day midnight
function minutesFrom(rosterDate: string, iso: string): number {
  return Math.round((Date.parse(iso) - Date.parse(`${rosterDate}T00:00:00+03:00`)) / 60_000);
}

// "HH:MM" to minutes; plusDay for next Fajr
function atMinutes(hhmm: string, plusDay = 0): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + plusDay * 1440;
}

function bestZoneFor(zones: readonly Zone[], rostersByZone: ReadonlyMap<string, Roster>): Zone | undefined {
  let best: { zone: Zone; rank: number } | undefined;
  for (const zone of zones) {
    const roster = rostersByZone.get(zone.id);
    const rank = roster === undefined ? ACTIONABLE_ORDER.length : ACTIONABLE_ORDER.indexOf(roster.status);
    if (best === undefined || rank < best.rank || (rank === best.rank && zone.name_en.localeCompare(best.zone.name_en) < 0)) {
      best = { zone, rank };
    }
  }
  return best?.zone;
}

// The most concurrent breaks at any 15-min slot.
function peakConcurrent(rows: readonly { readonly startMin: number; readonly endMin: number }[]): number {
  const load = new Map<number, number>();
  let peak = 0;
  for (const row of rows) {
    for (let slot = row.startMin; slot < row.endMin; slot += GRID) {
      const n = (load.get(slot) ?? 0) + 1;
      load.set(slot, n);
      if (n > peak) peak = n;
    }
  }
  return peak;
}

// Main loader

export interface BreakPlannerQuery {
  readonly zone?: string | undefined;
  readonly date?: string | undefined;
}

export async function loadBreakPlannerView(ctx: RequestContext, query: BreakPlannerQuery, locale: 'en' | 'ar'): Promise<BreakPlannerView> {
  const zones = (await listZones(ctx, { limit: 200 })).items;
  const today = await getDemoToday(ctx);
  const dateStr = query.date ?? addDays(today, 1);
  const dateLabel = dateBoth(dateStr, { locale });

  const rostersOnDate = (await listRosters(ctx, { date: dateStr, limit: 200 })).items;
  const rostersByZone = new Map(rostersOnDate.map((r) => [r.zone_id, r] as const));

  const requestedZone = query.zone === undefined ? undefined : zones.find((z: Zone) => z.id === query.zone);
  const zone = requestedZone ?? bestZoneFor(zones, rostersByZone) ?? zones[0];

  const zoneOptions = zones.map(pickerOf).sort((a: PickerOption, b: PickerOption) => a.code.localeCompare(b.code));
  const sources: DataSource[] = ['SYNTHETIC'];
  const empty = (z: PickerOption): BreakPlannerView => ({
    zone: z,
    zoneOptions,
    date: dateStr,
    dateLabel,
    prevDate: addDays(dateStr, -1),
    nextDate: addDays(dateStr, 1),
    sources,
    roster: undefined,
  });

  if (zone === undefined) return empty({ id: '', code: '', name: '' });

  const roster = rostersByZone.get(zone.id);
  if (roster === undefined) return empty(pickerOf(zone));
  sources.push(roster.data_source);

  // Only this zone's lines (as breaks.ts)
  const assignments = (await listRosterAssignments(ctx, roster.id, { limit: 200 })).items.filter((a) => a.zone_id === zone.id);
  const patterns = (await listShiftPatterns(ctx, { limit: 200 })).items.filter((p) => p.kind === 'field');
  const patternsById = new Map<string, ShiftPattern>(patterns.map((p) => [p.id, p] as const));
  const breakRulesById = new Map<string, BreakRule>((await listBreakRules(ctx, { limit: 200 })).items.map((r) => [r.id, r] as const));
  const agentsById = new Map<string, Agent>((await listAgents(ctx, { zone_id: zone.id, kind: 'field', limit: 200 })).items.map((s) => [s.id, s] as const));

  const todayTimes = (await listPrayerTimes(ctx, { city_id: zone.city_id, date_from: dateStr, date_to: dateStr, limit: 10 })).items[0];
  const nextTimes = (await listPrayerTimes(ctx, { city_id: zone.city_id, date_from: addDays(dateStr, 1), date_to: addDays(dateStr, 1), limit: 10 })).items[0];
  const prayers: PrayerMinute[] =
    todayTimes === undefined
      ? []
      : [
          { name: 'fajr', minute: atMinutes(todayTimes.fajr) },
          { name: 'dhuhr', minute: atMinutes(todayTimes.dhuhr) },
          { name: 'asr', minute: atMinutes(todayTimes.asr) },
          { name: 'maghrib', minute: atMinutes(todayTimes.maghrib) },
          { name: 'isha', minute: atMinutes(todayTimes.isha) },
        ];
  if (todayTimes !== undefined) sources.push(todayTimes.data_source);
  const allPrayers = nextTimes === undefined ? prayers : [...prayers, { name: 'fajr' as const, minute: atMinutes(nextTimes.fajr, 1) }];

  const plan = await getBreakPlan(ctx, { zone_id: zone.id, date: dateStr });
  const policy: BreakPrayerPolicy = { mode: plan.prayer_policy ?? DEFAULT_PRAYER_POLICY.mode, windowMinutes: plan.prayer_window_minutes ?? DEFAULT_PRAYER_POLICY.windowMinutes };

  function breakRuleOf(patternId: string): { readonly breakMinutes: number; readonly afterHours: number } {
    const pattern = patternsById.get(patternId);
    const rule = pattern === undefined ? undefined : breakRulesById.get(pattern.break_rule_id);
    return { breakMinutes: rule?.break_minutes ?? 30, afterHours: rule?.after_consecutive_hours ?? 5 };
  }

  const gridRows: RosterRow[] = [];
  const groups = new Map<string, ShiftGroupView>();
  const rows: BreakRowView[] = [];
  const sortedAssignments = [...assignments].sort((a: RosterAssignment, b: RosterAssignment) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id));
  for (const a of sortedAssignments) {
    const pattern = patternsById.get(a.shift_pattern_id);
    const agent = agentsById.get(a.agent_id);
    const shiftLabel = pattern === undefined ? '' : localizedName(pattern, locale);
    const shiftFrom = minutesFrom(dateStr, a.start_at) / 60;
    const shiftTo = minutesFrom(dateStr, a.end_at) / 60;
    const blocks: RosterBlock[] = [{ kind: 'shift', from: shiftFrom, to: shiftTo, label: shiftLabel, data: true }];

    if (a.break_start_at !== null && a.break_start_at !== undefined && a.break_end_at !== null && a.break_end_at !== undefined) {
      const startMin = minutesFrom(dateStr, a.break_start_at);
      const endMin = minutesFrom(dateStr, a.break_end_at);
      const conflict = prayerConflictOf(startMin, endMin, allPrayers, policy);
      const holds = conflict === null && holdsWholePrayer(startMin, endMin, allPrayers, policy);
      const kind = conflict !== null ? 'breakConflict' : holds ? 'breakHolds' : 'break';
      blocks.push({ kind, from: startMin / 60, to: endMin / 60, label: time(startMin), data: true, tip: `${time(startMin)}–${time(endMin)}`, selectable: true });

      const rule = breakRuleOf(a.shift_pattern_id);
      const shiftStartMin = minutesFrom(dateStr, a.start_at);
      const shiftEndMin = minutesFrom(dateStr, a.end_at);
      const earliestMin = Math.ceil((shiftStartMin + rule.afterHours * 60) / GRID) * GRID;
      const latestMin = Math.floor((shiftEndMin - rule.breakMinutes) / GRID) * GRID;

      rows.push({
        assignmentId: a.id,
        agentName: agent?.name_en ?? a.agent_id,
        agentCode: agent?.code ?? '',
        shiftLabel,
        startMin,
        endMin,
        durationMin: rule.breakMinutes,
        earliestMin,
        latestMin,
        prayerConflict: conflict,
        holds,
        overlapMinutes: overlapMinutesOf(startMin, endMin, allPrayers, policy),
      });
    }

    const sub = `${shiftLabel} · ${agent?.code ?? '—'}`;
    gridRows.push({ id: a.id, name: agent?.name_en ?? a.agent_id, sub, subIsData: true, blocks });

    const group = groups.get(a.shift_pattern_id) ?? { id: a.shift_pattern_id, label: shiftLabel, startMin: Infinity, endMin: -Infinity, rowIds: [] };
    groups.set(a.shift_pattern_id, {
      ...group,
      startMin: Math.min(group.startMin, minutesFrom(dateStr, a.start_at)),
      endMin: Math.max(group.endMin, minutesFrom(dateStr, a.end_at)),
      rowIds: [...group.rowIds, a.id],
    });
  }
  const shifts = [...groups.values()].sort((a, b) => a.startMin - b.startMin || a.label.localeCompare(b.label));

  const conflictRows = rows.filter((r) => r.prayerConflict !== null);
  const stats: BreakStatsView = {
    breaks: rows.length,
    conflicts: conflictRows.length,
    holds: rows.filter((r) => r.holds).length,
    peak: peakConcurrent(rows),
  };

  const coverageCost = plan.coverage_cost;

  return {
    zone: pickerOf(zone),
    zoneOptions,
    date: dateStr,
    dateLabel,
    prevDate: addDays(dateStr, -1),
    nextDate: addDays(dateStr, 1),
    sources: [...new Set(sources)],
    roster: {
      id: roster.id,
      status: roster.status,
      editable: EDITABLE_STATUSES.includes(roster.status),
      prayerChips: prayers,
      prayers: allPrayers,
      stats,
      coverageCost,
      gridRows,
      shifts,
      rows,
      conflictRows,
      policy,
    },
  };
}

