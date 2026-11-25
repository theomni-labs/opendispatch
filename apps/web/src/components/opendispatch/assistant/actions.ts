'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Assistant reads; Go guards and audits

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { askAssistant, explainWithAssistant, summariseMyAlerts, summariseShiftHandover, type AssistantAlertsDigest, type AssistantAnswer, type AssistantExplanation, type AssistantHandover } from '@/lib/data/assistant';

export interface ExplainInput {
  readonly target: string;
  readonly zone_id?: string | undefined;
  readonly date?: string | undefined;
  readonly locale: string;
}

export interface AskInput {
  readonly question: string;
  readonly locale: string;
}

const localeOf = (input: unknown): 'en' | 'ar' => (pickText(input, 'locale') === 'ar' ? 'ar' : 'en');

export async function explainScreen(input: ExplainInput): Promise<ActionResult<AssistantExplanation>> {
  return runAction((ctx) => {
    const fields = pickFields(input, ['target', 'zone_id', 'date']);
    const body: Record<string, unknown> = { target: fields.target, locale: localeOf(input) };
    if (typeof fields.zone_id === 'string' && fields.zone_id !== '') body['zone_id'] = fields.zone_id;
    if (typeof fields.date === 'string' && fields.date !== '') body['date'] = fields.date;
    return explainWithAssistant(ctx, body);
  });
}

export async function askQuestion(input: AskInput): Promise<ActionResult<AssistantAnswer>> {
  return runAction((ctx) => askAssistant(ctx, { question: pickText(input, 'question') ?? '', locale: localeOf(input) }));
}

const WINDOWS = [4, 8, 12] as const;

export async function summariseHandover(input: { readonly window_hours: number; readonly locale: string }): Promise<ActionResult<AssistantHandover>> {
  return runAction((ctx) => {
    const hours = (input as { window_hours?: unknown }).window_hours;
    const window_hours = WINDOWS.find((w) => w === hours) ?? 8;
    return summariseShiftHandover(ctx, { window_hours, locale: localeOf(input) });
  });
}

export async function summariseAlerts(input: { readonly locale: string }): Promise<ActionResult<AssistantAlertsDigest>> {
  return runAction((ctx) => summariseMyAlerts(ctx, { locale: localeOf(input) }));
}
