'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Leave Policy and Calendar screen: exactly the data functions of lib/data/time.ts.
//
//   saveHoliday      createHoliday / updateHoliday
//   removeHoliday    deleteHoliday
//   recomputePrayer  recomputePrayerTimes   (all cities, a range of days; Umm al-Qura through adhan)
//   savePolicy       updateLeavePolicy      (minimum notice, share, blackout periods)
//   saveRange        createCalendarEvent / updateCalendarEvent
//   removeRange      deleteCalendarEvent
//   setPayday        updatePaydayDay
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. The Hijri dates
// of a holiday are computed by the data layer from the Gregorian ones; the screen never sends them. The most on leave at once is
// typed as a percent and sent as the share the data layer keeps (0 to 1).
// (tools/rules/context-rules.test.ts scans this file for the forbidden names.)

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { readEventNoticeWithAssistant } from '@/lib/data/assistant';
import { InvalidInputError } from '@/lib/data/errors';
import { createCalendarEvent, createHoliday, deleteCalendarEvent, deleteHoliday, listCalendarEvents, listHolidays, recomputePrayerTimes, updateCalendarEvent, updateHoliday, updateLeavePolicy, updatePaydayDay } from '@/lib/data/time';
import type { HolidayTarget, NoticeRead, PaydayInput, RangeTarget, ReadNoticeInput, RecomputeInput, RecomputeResult, SaveHolidayInput, SaveNoticeInput, SavePolicyInput, SaveRangeInput, SavedHoliday, SavedRange } from './types';

const REVALIDATE = '/admin/leave-policy-calendar';
const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const nullIfEmpty = (value: string): string | null => (value === '' ? null : value);

/** Adds or changes a holiday: names, the Gregorian dates and the kind. The Hijri dates follow from the Gregorian ones. */
export async function saveHoliday(input: SaveHolidayInput): Promise<ActionResult<SavedHoliday>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['targetId', 'name_en', 'name_ar', 'start_date', 'end_date', 'kind']);
      const body = { name_en: textOf(fields['name_en']), name_ar: nullIfEmpty(textOf(fields['name_ar'])), start_date: fields['start_date'], end_date: fields['end_date'], kind: fields['kind'] };
      const targetId = typeof fields.targetId === 'string' && fields.targetId !== '' ? fields.targetId : undefined;
      if (targetId === undefined) {
        const created = await createHoliday(ctx, body);
        return { id: created.id, name: created.name_en, created: true } satisfies SavedHoliday;
      }
      const updated = await updateHoliday(ctx, targetId, body);
      return { id: updated.id, name: updated.name_en, created: false } satisfies SavedHoliday;
    },
    { revalidate: REVALIDATE },
  );
}

/** Deletes a holiday. */
export async function removeHoliday(input: HolidayTarget): Promise<ActionResult<SavedHoliday>> {
  return runAction(
    async (ctx) => {
      const targetId = pickText(input, 'targetId') ?? '';
      // The name is only for the toast: a caller who may not read the holidays still reaches the delete, which refuses and audits it.
      const name = await (async (): Promise<string> => {
        try {
          return (await listHolidays(ctx, { limit: 200 })).items.find((h) => h.id === targetId)?.name_en ?? '';
        } catch {
          return '';
        }
      })();
      await deleteHoliday(ctx, targetId);
      return { id: targetId, name, created: false } satisfies SavedHoliday;
    },
    { revalidate: REVALIDATE },
  );
}

/** Recomputes and stores the prayer times of every city for a range of days. */
export async function recomputePrayer(input: RecomputeInput): Promise<ActionResult<RecomputeResult>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['date_from', 'date_to']);
      const result = await recomputePrayerTimes(ctx, { city_id: null, date_from: fields['date_from'], date_to: fields['date_to'] });
      const cities = new Set(result.items.map((p) => p.city_id)).size;
      const days = new Set(result.items.map((p) => p.prayer_date)).size;
      return { cities, days, records: result.items.length } satisfies RecomputeResult;
    },
    { revalidate: REVALIDATE },
  );
}

/** Saves the leave policy: minimum notice in days, the most on leave at once as a percent, and the blackout periods. */
export async function savePolicy(input: SavePolicyInput): Promise<ActionResult<{ readonly saved: true }>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['min_notice_days', 'share_percent', 'blackout_periods']);
      const percent = fields['share_percent'];
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) throw new InvalidInputError('Most on leave at once: a percent from 0 to 100.');
      const periods = Array.isArray(fields['blackout_periods']) ? (fields['blackout_periods'] as unknown[]).map((p) => pickFields(p, ['start_date', 'end_date', 'label_en'])) : fields['blackout_periods'];
      await updateLeavePolicy(ctx, { min_notice_days: fields['min_notice_days'], max_concurrent_leave_share: percent / 100, blackout_periods: periods });
      return { saved: true as const };
    },
    { revalidate: REVALIDATE },
  );
}

/** Adds or changes a school term, season event or Umrah window. */
export async function saveRange(input: SaveRangeInput): Promise<ActionResult<SavedRange>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['targetId', 'kind', 'name', 'start_date', 'end_date']);
      const body = { kind: fields['kind'], name: textOf(fields['name']), start_date: fields['start_date'], end_date: fields['end_date'] };
      const targetId = typeof fields.targetId === 'string' && fields.targetId !== '' ? fields.targetId : undefined;
      const saved = targetId === undefined ? await createCalendarEvent(ctx, body) : await updateCalendarEvent(ctx, targetId, body);
      return { id: saved.id, name: saved.name, created: targetId === undefined } satisfies SavedRange;
    },
    { revalidate: REVALIDATE },
  );
}

/** Removes a date range set here. */
export async function removeRange(input: RangeTarget): Promise<ActionResult<SavedRange>> {
  return runAction(
    async (ctx) => {
      const targetId = pickText(input, 'targetId') ?? '';
      // The name is for the toast; Go refuses and audits a role without edit.
      const name = await (async (): Promise<string> => {
        try {
          return (await listCalendarEvents(ctx)).items.find((e) => e.id === targetId)?.name ?? '';
        } catch {
          return '';
        }
      })();
      await deleteCalendarEvent(ctx, targetId);
      return { id: targetId, name, created: false } satisfies SavedRange;
    },
    { revalidate: REVALIDATE },
  );
}

/** Sets the payday day; 0 removes it. */
export async function setPayday(input: PaydayInput): Promise<ActionResult<PaydayInput>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['payday_day']);
      const saved = await updatePaydayDay(ctx, { payday_day: fields['payday_day'] });
      return { payday_day: saved.payday_day } satisfies PaydayInput;
    },
    { revalidate: REVALIDATE },
  );
}

/** Reads a pasted notice into drafts; saves nothing. */
export async function readNotice(input: ReadNoticeInput): Promise<ActionResult<NoticeRead>> {
  return runAction(async (ctx) => {
    const out = await readEventNoticeWithAssistant(ctx, { text: pickText(input, 'text') ?? '', locale: pickText(input, 'locale') === 'ar' ? 'ar' : 'en' });
    const drafts = out.events.map((e) => ({
      nameEn: e.name_en,
      nameAr: e.name_ar ?? null,
      noticeType: e.notice_type,
      city: e.city ?? null,
      zoneIds: e.zone_ids,
      startDate: e.start_date,
      endDate: e.end_date,
      startTime: e.start_time ?? null,
      endTime: e.end_time ?? null,
      impact: e.impact,
      impactReason: e.impact_reason,
      quote: e.quote,
      fromHijri: e.from_hijri,
    }));
    return { provider: out.provider, model: out.model, duration_ms: out.duration_ms, drafts, unmapped: out.unmapped } satisfies NoticeRead;
  });
}

/** Saves one reviewed draft as a notice event. */
export async function saveNotice(input: SaveNoticeInput): Promise<ActionResult<SavedRange>> {
  return runAction(
    async (ctx) => {
      const f = pickFields(input, ['name', 'name_ar', 'notice_type', 'zone_ids', 'start_date', 'end_date', 'start_time', 'end_time', 'impact', 'impact_reason', 'quote']);
      const zoneIds = Array.isArray(f['zone_ids']) ? (f['zone_ids'] as unknown[]).filter((z): z is string => typeof z === 'string') : [];
      const body = {
        kind: 'notice',
        name: textOf(f['name']),
        name_ar: nullIfEmpty(textOf(f['name_ar'])),
        start_date: f['start_date'],
        end_date: f['end_date'],
        notice: {
          notice_type: f['notice_type'],
          zone_ids: zoneIds,
          start_time: nullIfEmpty(textOf(f['start_time'])),
          end_time: nullIfEmpty(textOf(f['end_time'])),
          impact: f['impact'],
          impact_reason: nullIfEmpty(textOf(f['impact_reason'])),
          quote: nullIfEmpty(textOf(f['quote'])),
          assisted: true,
        },
      };
      const saved = await createCalendarEvent(ctx, body);
      return { id: saved.id, name: saved.name, created: true } satisfies SavedRange;
    },
    { revalidate: REVALIDATE },
  );
}
