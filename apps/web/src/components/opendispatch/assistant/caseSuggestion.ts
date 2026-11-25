// SPDX-License-Identifier: AGPL-3.0-only
// Case suggestion: plain data for the card

import type { CaseSuggestion, CaseSuggestionView } from '@/lib/data/case-suggestions';
import type { AssistantRuleView } from '@/lib/types';

export type CaseScreen = 'live_dispatch_board' | 'remote_queue';

export interface RuleLine {
  readonly handling: 'field' | 'remote_inferred';
  /** Null: the default outcome applied. */
  readonly ruleName: string | null;
}

export interface SuggestionView {
  readonly handling: 'field' | 'remote_inferred';
  readonly severity: 'minor' | 'moderate' | 'severe';
  readonly injury: boolean;
  readonly method: 'photo' | 'video' | 'in_person';
  readonly confidencePct: number;
  readonly reason: string;
  readonly quote: string;
  /** The language the reason was written in. */
  readonly locale: 'en' | 'ar';
  readonly agrees: boolean;
  readonly rule: RuleLine;
  readonly provider: string;
  readonly model: string;
  readonly durationMs: number;
  readonly textOnly: boolean;
  readonly suggestedAt: string;
  readonly review: { readonly decision: 'accepted' | 'rejected'; readonly by: string } | null;
}

export interface CaseSuggestionCardView {
  readonly caseId: string;
  readonly from: CaseScreen;
  readonly narrative: string | null;
  /** The description is in the other language. */
  readonly narrativeDir: 'ltr' | 'rtl';
  readonly photos: number;
  readonly rule: RuleLine;
  readonly suggestion: SuggestionView | null;
}

/** @pure The rule outcome in the reader's language. */
export function ruleLineOf(rule: AssistantRuleView, locale: string): RuleLine {
  const name = locale === 'ar' ? (rule.rule_name_ar ?? rule.rule_name_en) : rule.rule_name_en;
  return { handling: rule.handling, ruleName: rule.rule_code === null ? null : (name ?? rule.rule_code) };
}

/** @pure A suggestion as the card shows it. */
export function suggestionViewOf(s: CaseSuggestion, locale: string): SuggestionView {
  return {
    handling: s.classification.handling,
    severity: s.classification.severity,
    injury: s.classification.injury_present,
    method: s.classification.damage_assessment_method,
    confidencePct: Math.round(s.classification.confidence * 100),
    reason: s.classification.reason,
    quote: s.classification.quote,
    locale: s.locale === 'ar' ? 'ar' : 'en',
    agrees: s.agrees_with_rules,
    rule: ruleLineOf(s.rule, locale),
    provider: s.provider,
    model: s.model,
    durationMs: s.duration_ms,
    textOnly: s.text_only,
    suggestedAt: s.suggested_at,
    review: s.review === null ? null : { decision: s.review.decision, by: s.review.reviewed_by_name },
  };
}

/** @pure The card's data from the api's case view. */
export function caseSuggestionCardOf(view: CaseSuggestionView, from: CaseScreen, locale: string): CaseSuggestionCardView {
  const own = locale === 'ar' ? view.narrative_ar : view.narrative_en;
  const other = locale === 'ar' ? view.narrative_en : view.narrative_ar;
  const narrative = own ?? other ?? null;
  const ownDir = locale === 'ar' ? 'rtl' : 'ltr';
  const otherDir = locale === 'ar' ? 'ltr' : 'rtl';
  return {
    caseId: view.case_id,
    from,
    narrative,
    narrativeDir: own === null && other !== null ? otherDir : ownDir,
    photos: view.photos.length,
    rule: ruleLineOf(view.rule, locale),
    suggestion: view.suggestion === null ? null : suggestionViewOf(view.suggestion, locale),
  };
}
