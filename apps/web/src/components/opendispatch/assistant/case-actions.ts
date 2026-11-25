'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Case suggestions; Go guards, checks and audits

import { pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { reviewCaseSuggestion, suggestCaseClassification } from '@/lib/data/case-suggestions';
import { suggestionViewOf, type SuggestionView } from './caseSuggestion';

export interface SuggestCaseInput {
  readonly caseId: string;
  readonly from: string;
  readonly locale: string;
}

export interface ReviewCaseInput {
  readonly caseId: string;
  readonly from: string;
  readonly decision: string;
  readonly suggestedAt: string;
  readonly locale: string;
}

const PATHS: Readonly<Record<string, string>> = { live_dispatch_board: '/ops/live-dispatch-board', remote_queue: '/ops/remote-queue' };

const screenOf = (input: unknown): 'live_dispatch_board' | 'remote_queue' => (pickText(input, 'from') === 'live_dispatch_board' ? 'live_dispatch_board' : 'remote_queue');
const localeOf = (input: unknown): 'en' | 'ar' => (pickText(input, 'locale') === 'ar' ? 'ar' : 'en');

export async function suggestCaseAction(input: SuggestCaseInput): Promise<ActionResult<SuggestionView>> {
  const from = screenOf(input);
  return runAction(
    async (ctx) => {
      const locale = localeOf(input);
      const s = await suggestCaseClassification(ctx, pickText(input, 'caseId') ?? '', { from, locale });
      return suggestionViewOf(s, locale);
    },
    { revalidate: PATHS[from] },
  );
}

export async function reviewCaseAction(input: ReviewCaseInput): Promise<ActionResult<SuggestionView>> {
  const from = screenOf(input);
  return runAction(
    async (ctx) => {
      const decision = pickText(input, 'decision') as 'accepted' | 'rejected';
      const s = await reviewCaseSuggestion(ctx, pickText(input, 'caseId') ?? '', { from, decision, suggested_at: pickText(input, 'suggestedAt') ?? '' });
      return suggestionViewOf(s, localeOf(input));
    },
    { revalidate: PATHS[from] },
  );
}
