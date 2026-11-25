// SPDX-License-Identifier: AGPL-3.0-only
// Client-safe UI shapes (no lib/data)

export const HEADCOUNT_MIN = -50;
export const HEADCOUNT_MAX = 50;
export const SHARE_MIN = 0;
export const SHARE_MAX = 100;
export const SHARE_STEP = 5;

export const TEMPLATE_KEYS = ['people', 'ramadan', 'remote'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** One pool change, or per-zone changes adding up. */
export type RemoteMode = 'company' | 'zone';

/** Mirrors Scenario['status'] (the contract). */
export type ScenarioStatus = 'draft' | 'running' | 'completed' | 'failed';

/** The editor's own fields; maps to one Scenario. */
export interface ScenarioFormValues {
  readonly name: string;
  readonly baseDate: string;
  readonly zoneIds: readonly string[];
  readonly field: number;
  /** Company-wide remote change (mode company). */
  readonly remote: number;
  readonly remoteMode: RemoteMode;
  /** Per-zone remote changes (mode zone). */
  readonly remoteByZone: Readonly<Record<string, number>>;
  readonly veh: number;
  /** Percent (0-100), or null: unchanged. */
  readonly sharePercent: number | null;
  readonly patternIds: readonly string[];
}

export interface SaveScenarioInput extends ScenarioFormValues {
  /** Null creates a scenario; an id updates it. */
  readonly id: string | null;
}

export interface RunScenarioInput {
  readonly id: string;
}

export interface ScenarioTarget {
  readonly id: string;
}

export interface ScenarioTargets {
  readonly ids: readonly string[];
}

export interface BulkDeleteResult {
  readonly deleted: number;
  readonly failed: number;
}

export interface DuplicateScenarioInput {
  readonly id: string;
}

export interface DraftScenarioInput {
  readonly text: string;
  readonly locale: string;
}

/** The assistant's draft, as editor values. */
export interface ScenarioDraftResult {
  readonly provider: string;
  readonly model: string;
  readonly duration_ms: number;
  readonly form: ScenarioFormValues;
  readonly unmapped: readonly string[];
}
