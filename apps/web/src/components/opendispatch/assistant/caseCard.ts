// SPDX-License-Identifier: AGPL-3.0-only
import { getAssistantStatus } from '@/lib/data/assistant';
import { getCaseSuggestion } from '@/lib/data/case-suggestions';
import type { RequestContext } from '@/lib/data/guard';
import { caseSuggestionCardOf, type CaseScreen, type CaseSuggestionCardView } from './caseSuggestion';

// Server side: one case's AI card data

export interface CaseAiCard {
  readonly view: CaseSuggestionCardView;
  readonly configured: boolean;
  readonly offline: boolean;
}

/** Null when the case or the api cannot say: no card. */
export async function loadCaseAiCard(ctx: RequestContext, caseId: string, from: CaseScreen, locale: string): Promise<CaseAiCard | null> {
  try {
    const [view, status] = await Promise.all([getCaseSuggestion(ctx, caseId, from), getAssistantStatus(ctx).catch(() => null)]);
    if (view === null) return null;
    return { view: caseSuggestionCardOf(view, from, locale), configured: status?.configured ?? false, offline: status?.offline ?? false };
  } catch {
    return null;
  }
}
