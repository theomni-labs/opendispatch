'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Shift and Break Policies screen: exactly the data functions of lib/data/time.ts.
//
//   savePattern         createShiftPattern / updateShiftPattern
//   setPatternsStatus   updateShiftPattern once per pattern   (the bulk bar: set active or draft, N calls)
//   saveBreakRule       updateBreakRule                       (minutes and hours; the code and the name stay)
//   savePrayerPolicy    updateBreakPrayerPolicy
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. An update starts
// from the record as stored, because the data layer's bodies are complete. The screen sends only what a person typed.
// (tools/rules/context-rules.test.ts scans this file for the forbidden names.)

import { pickFields, pickText, pickTextList } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { DataError, ForbiddenError, InvalidInputError, NotFoundError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { updateBreakPrayerPolicy } from '@/lib/data/settings';
import { createShiftPattern, getShiftPattern, listBreakRules, updateBreakRule, updateShiftPattern } from '@/lib/data/time';
import type { ShiftHours, ShiftPattern } from '@/lib/types';
import type { BulkResult, PatternTargets, PrayerPolicyInput, SaveBreakRuleInput, SavePatternInput, SavedBreakRule, SavedPattern, SavedPrayerPolicy } from './types';

const REVALIDATE = '/admin/shift-break-policies';
const MAX_BULK = 100;

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

async function stored<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return undefined;
    throw error;
  }
}

/** The hours the person typed as the data layer's body: `{ applies: false }` when the pattern does not run in that mode. */
function hoursBody(value: unknown): Record<string, unknown> {
  const hours = pickFields(value, ['applies', 'start_time', 'end_time']);
  return hours.applies === true ? { applies: true, start_time: hours.start_time, end_time: hours.end_time } : { applies: false };
}

/** A stored pattern's hours as the body wants them (`crosses_midnight` is derived, so it is not sent back). */
const storedHours = (hours: ShiftHours): Record<string, unknown> => (hours.applies ? { applies: true, start_time: hours.start_time, end_time: hours.end_time } : { applies: false });

const bodyOf = (pattern: ShiftPattern, changes: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
  code: pattern.code,
  name_en: pattern.name_en,
  name_ar: pattern.name_ar ?? null,
  kind: pattern.kind,
  normal: storedHours(pattern.normal),
  ramadan: storedHours(pattern.ramadan),
  break_rule_id: pattern.break_rule_id,
  status: pattern.status,
  ...changes,
});

/** Adds or changes a shift pattern: the code is asked for on an add and stays on a change. */
export async function savePattern(input: SavePatternInput): Promise<ActionResult<SavedPattern>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['targetId', 'name_en', 'code', 'kind', 'normal', 'ramadan', 'break_rule_id', 'status']);
      const targetId = typeof fields.targetId === 'string' && fields.targetId !== '' ? fields.targetId : undefined;
      const changes = { name_en: textOf(fields['name_en']), kind: fields['kind'], normal: hoursBody(fields['normal']), ramadan: hoursBody(fields['ramadan']), break_rule_id: fields['break_rule_id'], status: fields['status'] };
      if (targetId === undefined) {
        const created = await createShiftPattern(ctx, { code: textOf(fields['code']), name_ar: null, ...changes });
        return { id: created.id, code: created.code, created: true, status: created.status } satisfies SavedPattern;
      }
      const current = await stored(() => getShiftPattern(ctx, targetId));
      const updated = await updateShiftPattern(ctx, targetId, current === undefined ? changes : bodyOf(current, changes));
      return { id: updated.id, code: updated.code, created: false, status: updated.status } satisfies SavedPattern;
    },
    { revalidate: REVALIDATE },
  );
}

/**
 * Sets each pattern named to `active` or `draft`, one data call each (each audited). A refusal for one pattern (not found) is
 * counted and the rest go on; a refusal that concerns the caller (no session, no permission) stops at the first, so a viewer leaves
 * one `denied` event.
 */
export async function setPatternsStatus(input: PatternTargets): Promise<ActionResult<BulkResult>> {
  return runAction(
    async (ctx) => {
      const ids = pickTextList(input, 'targetIds', MAX_BULK);
      const status = pickText(input, 'status');
      if (ids === undefined || ids.length === 0) throw new InvalidInputError(`Patterns: name 1 to ${MAX_BULK}.`);
      if (status !== 'active' && status !== 'draft') throw new InvalidInputError('Status: active or draft.');
      let changed = 0;
      let failed = 0;
      let firstProblem: string | undefined;
      for (const id of [...new Set(ids)]) {
        try {
          const current = await stored(() => getShiftPattern(ctx, id));
          if (current?.status === status) continue;
          await updateShiftPattern(ctx, id, current === undefined ? { status } : bodyOf(current, { status }));
          changed += 1;
        } catch (error) {
          if (!(error instanceof DataError) || error.code === 'forbidden' || error.code === 'unauthenticated') throw error;
          failed += 1;
          firstProblem ??= error.message;
        }
      }
      return { changed, failed, status, ...(firstProblem === undefined ? {} : { firstProblem }) } satisfies BulkResult;
    },
    { revalidate: REVALIDATE },
  );
}

const findBreak = async (ctx: RequestContext, id: string) => (await listBreakRules(ctx, { limit: 200 })).items.find((b) => b.id === id);

/** Changes a break rule's length and the hours worked before it. The rule's code and name stay. */
export async function saveBreakRule(input: SaveBreakRuleInput): Promise<ActionResult<SavedBreakRule>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['targetId', 'break_minutes', 'after_consecutive_hours']);
      const targetId = textOf(fields['targetId']);
      const current = await stored(() => findBreak(ctx, targetId));
      const kept = current === undefined ? {} : { code: current.code, name_en: current.name_en, name_ar: current.name_ar ?? null };
      const updated = await updateBreakRule(ctx, targetId, { ...kept, break_minutes: fields['break_minutes'], after_consecutive_hours: fields['after_consecutive_hours'] });
      return { id: updated.id, code: updated.code } satisfies SavedBreakRule;
    },
    { revalidate: REVALIDATE },
  );
}

/** How breaks meet prayer (Administrator). */
export async function savePrayerPolicy(input: PrayerPolicyInput): Promise<ActionResult<SavedPrayerPolicy>> {
  return runAction(
    async (ctx) => {
      const saved = await updateBreakPrayerPolicy(ctx, pickFields(input, ['prayer_policy', 'prayer_window_minutes']));
      return { mode: saved.break_prayer_policy ?? 'clear_of_prayer', windowMinutes: saved.prayer_window_minutes ?? 30 } satisfies SavedPrayerPolicy;
    },
    { revalidate: REVALIDATE },
  );
}
