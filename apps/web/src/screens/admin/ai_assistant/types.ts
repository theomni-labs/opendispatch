// SPDX-License-Identifier: AGPL-3.0-only
// AI Assistant screen data: JSON-safe, no context.

export type AssistantStatusValue = 'on' | 'off' | 'not_configured';
export type AssistantProviderValue = 'off' | 'ollama' | 'openai';
export type AssistantKeyValue = 'configured' | 'not_configured' | 'not_needed';
export type AssistantFeatureValue = 'rule_draft' | 'explain' | 'ask' | 'tool_call';
export type AssistantTestCode = 'off' | 'not_configured' | 'timeout' | 'provider_error' | 'empty_answer';

export interface UsageRow {
  readonly feature: AssistantFeatureValue;
  readonly calls: number;
  readonly successes: number;
  /** rule_draft only */
  readonly rejected: number | null;
  /** explain only */
  readonly retried: number | null;
  readonly fallbacks: number | null;
  readonly medianMs: number | null;
  readonly p90Ms: number | null;
}

export interface LastTest {
  readonly ok: boolean;
  readonly durationMs: number;
  readonly errorCode: AssistantTestCode | null;
  readonly testedAt: string;
}

export interface AssistantView {
  readonly status: AssistantStatusValue;
  readonly provider: AssistantProviderValue;
  readonly model: string;
  readonly offline: boolean;
  readonly key: AssistantKeyValue;
  readonly calls: number;
  /** Share of successes, 0 to 100; null with no calls. */
  readonly successPct: number | null;
  readonly usage: readonly UsageRow[];
  readonly lastTest: LastTest | null;
}

/** What the test action gives back. */
export interface TestOutcome {
  readonly ok: boolean;
  readonly durationMs: number;
  readonly errorCode: AssistantTestCode | null;
}
