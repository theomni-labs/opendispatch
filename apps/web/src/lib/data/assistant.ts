// SPDX-License-Identifier: AGPL-3.0-only
// AI assistant: thin Go client.

import type { AssistantAlertsDigest, AssistantEventNoticeDraft, AssistantHandover, AssistantImportIssues, AssistantMappingSuggestion, AssistantOverview, AssistantScenarioDraft, AssistantTestResult, DataSource, RuleCondition, RuleOutcome } from '@/lib/types';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';

// Local until the proposal is in the contract
export type AssistantExplainTarget = 'forecast_explorer' | 'gap_surplus';

export interface AssistantStatus {
  readonly provider: 'off' | 'ollama' | 'openai';
  readonly model: string;
  readonly configured: boolean;
  readonly offline: boolean;
  readonly reason?: string;
  readonly features: {
    readonly rule_draft: boolean;
    readonly explain: readonly AssistantExplainTarget[];
    readonly ask: boolean;
    readonly import_mapping?: boolean;
    readonly import_issues?: boolean;
    readonly event_notice?: boolean;
    readonly scenario_draft?: boolean;
    readonly handover?: boolean;
    readonly alerts_digest?: boolean;
  };
}

export interface AssistantMeta {
  readonly provider: string;
  readonly model: string;
  readonly duration_ms: number;
  readonly suggestion: boolean;
  readonly illustrative: boolean;
  readonly data_source: DataSource;
}

export interface AssistantRuleDraft extends AssistantMeta {
  readonly draft: {
    readonly name_en: string;
    readonly name_ar: string | null;
    readonly condition: RuleCondition;
    readonly condition_text_en: string;
    readonly outcome: RuleOutcome;
  };
  // Phrases the draft could not hold
  readonly unmapped?: readonly string[];
}

export interface AssistantExplanation extends AssistantMeta {
  readonly target: AssistantExplainTarget;
  readonly text: string;
  readonly sent: string;
}

export interface AssistantToolCall {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly ok: boolean;
}

export interface AssistantAnswer extends AssistantMeta {
  readonly answer: string;
  readonly refused: boolean;
  readonly capped: boolean;
  readonly tool_calls: readonly AssistantToolCall[];
}

// operationId: getAssistantStatus
export async function getAssistantStatus(ctx: RequestContext): Promise<AssistantStatus> {
  return (await businessFetch<AssistantStatus>(ctx, '/assistant/status'))!;
}

// operationId: draftRuleWithAssistant
export async function draftRuleWithAssistant(ctx: RequestContext, body: unknown): Promise<AssistantRuleDraft> {
  return (await businessFetch<AssistantRuleDraft>(ctx, '/assistant/rule-draft', { method: 'POST', body }))!;
}

// operationId: explainWithAssistant
export async function explainWithAssistant(ctx: RequestContext, body: unknown): Promise<AssistantExplanation> {
  return (await businessFetch<AssistantExplanation>(ctx, '/assistant/explain', { method: 'POST', body }))!;
}

// operationId: askAssistant
export async function askAssistant(ctx: RequestContext, body: unknown): Promise<AssistantAnswer> {
  return (await businessFetch<AssistantAnswer>(ctx, '/assistant/ask', { method: 'POST', body }))!;
}

// operationId: getAssistantOverview
export async function getAssistantOverview(ctx: RequestContext): Promise<AssistantOverview> {
  return (await businessFetch<AssistantOverview>(ctx, '/assistant/overview'))!;
}

// operationId: testAssistantConnection
export async function testAssistantConnection(ctx: RequestContext): Promise<AssistantTestResult> {
  return (await businessFetch<AssistantTestResult>(ctx, '/assistant/test', { method: 'POST' }))!;
}

export type { AssistantImportIssues, AssistantMappingSuggestion };

// operationId: suggestImportMappingWithAssistant
export async function suggestImportMappingWithAssistant(ctx: RequestContext, body: unknown): Promise<AssistantMappingSuggestion> {
  return (await businessFetch<AssistantMappingSuggestion>(ctx, '/assistant/import-mapping', { method: 'POST', body }))!;
}

// operationId: explainImportIssuesWithAssistant
export async function explainImportIssuesWithAssistant(ctx: RequestContext, body: unknown): Promise<AssistantImportIssues> {
  return (await businessFetch<AssistantImportIssues>(ctx, '/assistant/import-issues', { method: 'POST', body }))!;
}

export type { AssistantEventNoticeDraft, AssistantScenarioDraft };

// operationId: readEventNoticeWithAssistant
export async function readEventNoticeWithAssistant(ctx: RequestContext, body: unknown): Promise<AssistantEventNoticeDraft> {
  return (await businessFetch<AssistantEventNoticeDraft>(ctx, '/assistant/event-notice', { method: 'POST', body }))!;
}

// operationId: draftScenarioWithAssistant
export async function draftScenarioWithAssistant(ctx: RequestContext, body: unknown): Promise<AssistantScenarioDraft> {
  return (await businessFetch<AssistantScenarioDraft>(ctx, '/assistant/scenario-draft', { method: 'POST', body }))!;
}

export type { AssistantAlertsDigest, AssistantHandover };

// operationId: summariseShiftHandover
export async function summariseShiftHandover(ctx: RequestContext, body: unknown): Promise<AssistantHandover> {
  return (await businessFetch<AssistantHandover>(ctx, '/assistant/handover', { method: 'POST', body }))!;
}

// operationId: summariseMyAlerts
export async function summariseMyAlerts(ctx: RequestContext, body: unknown): Promise<AssistantAlertsDigest> {
  return (await businessFetch<AssistantAlertsDigest>(ctx, '/assistant/alerts-digest', { method: 'POST', body }))!;
}
