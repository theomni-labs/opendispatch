// SPDX-License-Identifier: AGPL-3.0-only
// AI case suggestions and classifier review (Go).

import type {
  AssistantCaseReviewRequest,
  AssistantCaseScreen,
  AssistantCaseSuggestion,
  AssistantCaseSuggestionRequest,
  AssistantCaseView,
  ClassifierReview,
  ClassifierRun,
  ClassifierRunRequest,
} from '@/lib/types';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';

// Local until the classification amendment lands
export type CaseSuggestion = AssistantCaseSuggestion;
export type CaseSuggestionView = AssistantCaseView;

export interface ClassifierReviewQuery {
  readonly days?: number | undefined;
  readonly only?: 'all' | 'disagreements' | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

function caseUrl(caseId: string): string {
  return `/assistant/case-suggestions/${encodeURIComponent(caseId)}`;
}

// operationId: getCaseSuggestion
export async function getCaseSuggestion(ctx: RequestContext, caseId: string, from: AssistantCaseScreen): Promise<CaseSuggestionView | null> {
  const view = await businessFetch<CaseSuggestionView>(ctx, `${caseUrl(caseId)}?from=${encodeURIComponent(from)}`);
  return view ?? null;
}

// operationId: suggestCaseClassification
export async function suggestCaseClassification(ctx: RequestContext, caseId: string, body: AssistantCaseSuggestionRequest): Promise<CaseSuggestion> {
  return (await businessFetch<CaseSuggestion>(ctx, caseUrl(caseId), { method: 'POST', body }))!;
}

// operationId: reviewCaseSuggestion
export async function reviewCaseSuggestion(ctx: RequestContext, caseId: string, body: AssistantCaseReviewRequest): Promise<CaseSuggestion> {
  return (await businessFetch<CaseSuggestion>(ctx, `${caseUrl(caseId)}/review`, { method: 'POST', body }))!;
}

// operationId: getClassifierReview
export async function getClassifierReview(ctx: RequestContext, query: ClassifierReviewQuery = {}): Promise<ClassifierReview> {
  const params = new URLSearchParams();
  if (query.days !== undefined) params.set('days', String(query.days));
  if (query.only !== undefined) params.set('only', query.only);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  const qs = params.toString();
  return (await businessFetch<ClassifierReview>(ctx, `/assistant/classifier-review${qs === '' ? '' : `?${qs}`}`))!;
}

// operationId: runClassifierReview
export async function runClassifierReview(ctx: RequestContext, body: ClassifierRunRequest): Promise<ClassifierRun> {
  return (await businessFetch<ClassifierRun>(ctx, '/assistant/classifier-review/run', { method: 'POST', body }))!;
}
