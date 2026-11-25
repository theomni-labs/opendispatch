// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Forecast and Model Admin screen: what the server side hands to the client files.
// JSON-safe (strings, numbers, booleans, arrays and objects of those). Nothing here is a context, a customer or the caller's
// role. THE FORECASTER IS A PLACEHOLDER ENGINE: every figure on this screen is Illustrative.

import type { DataSource } from '@/lib/types';

export type VersionStatus = 'candidate' | 'active' | 'retired' | 'challenger';
export type Cadence = 'manual' | 'daily' | 'weekly' | 'monthly';
export type ClockStart = 'assignment' | 'registration';
export type PlanningLevel = 'zone' | 'sub_zone' | 'city';
export const CADENCES: readonly Cadence[] = ['manual', 'daily', 'weekly', 'monthly'];
export const CLOCK_STARTS: readonly ClockStart[] = ['assignment', 'registration'];
export const PLANNING_LEVELS: readonly PlanningLevel[] = ['zone', 'sub_zone', 'city'];
export type OptimizerModel = 'cpsat-1' | 'greedy-ls-0.3' | 'greedy-ls-0.2' | 'greedy-ls-0.1';
export const OPTIMIZER_MODELS: readonly OptimizerModel[] = ['cpsat-1', 'greedy-ls-0.3', 'greedy-ls-0.2', 'greedy-ls-0.1'];
/** A model's message key (keys hold no dots). */
export type RemoteHandlingSource = 'measured' | 'fixed';
export const REMOTE_HANDLING_SOURCES: readonly RemoteHandlingSource[] = ['measured', 'fixed'];
export const OPTIMIZER_KEY: Readonly<Record<OptimizerModel, string>> = { 'greedy-ls-0.3': 'greedy03', 'cpsat-1': 'cpsat1', 'greedy-ls-0.2': 'greedy02', 'greedy-ls-0.1': 'greedy01' };

export interface VersionRow {
  readonly id: string;
  readonly version: string;
  readonly status: VersionStatus;
  /** ISO 8601, or null when the version was never trained. */
  readonly trainedAt: string | null;
  readonly engine: string | null;
  readonly placeholder: boolean;
  /** Lift over the champion; Illustrative. */
  readonly lift?: LiftView | null;
}

export interface LiftView {
  readonly wape: number | null;
  readonly mape: number | null;
}

/** The challenger, its latest run and lift. */
export interface ChallengerView {
  readonly model: string;
  readonly run: { readonly finished_at?: string | null; readonly engine_version?: string | null } | undefined;
  readonly lift: LiftView | null;
}

export interface RunView {
  readonly id: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly model: string;
  readonly engine: string | null;
  readonly ruleSet: string | null;
  /** `YYYY-MM-DD`. */
  readonly horizonStart: string;
  readonly horizonDays: number;
  /** Share of the range the run covers (0.8 = 80%). Illustrative. */
  readonly coverage: number;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly sources: readonly DataSource[];
  /** The history it was fitted on. */
  readonly snapshot: string | null;
}

export interface PauseView {
  readonly paused: boolean;
  readonly pausedAt: string | null;
  /** The display name of the person who paused it, when the caller may read it. */
  readonly pausedBy: string | null;
  readonly reason: string | null;
}

export interface ScheduleView {
  readonly cadence: Cadence;
  /** 0 (Sunday) to 6; only for a weekly cadence. */
  readonly day: number | null;
  /** `HH:MM`. */
  readonly time: string;
}

/** The 10-minute reading, both ways. Shares are 0 to 1; null when no roll-up can be read. */
export interface ReadingView {
  readonly fromAssignment: number | null;
  readonly fromRegistration: number | null;
  readonly illustrative: boolean;
}

/** The working assumptions (getWorkingAssumptions). */
export interface AssumptionsView {
  readonly liveSpeedKmh: number;
  readonly planningSpeedKmh: number;
  readonly clockStart: ClockStart;
  readonly clockConfirmed: boolean;
  /** 0 is off. */
  readonly paydayDay: number;
  readonly handlingInferred: boolean;
  readonly caseSources: readonly DataSource[];
  readonly weather: {
    readonly source: 'stored' | 'feed' | 'none';
    readonly cities: number;
    readonly from: string | null;
    readonly to: string | null;
    readonly attribution: string | null;
  };
  /** Where weather comes from when none is stored. */
  readonly weatherFeed: WeatherFeed;
  readonly trafficSource: TrafficSource;
}

export type WeatherFeed = 'none' | 'file' | 'openmeteo' | 'synthetic';
export type TrafficSource = 'none' | 'file' | 'synthetic';

export interface HistoryEvent {
  readonly id: string;
  readonly action: string;
  readonly summary_en: string;
  readonly occurred_at: string;
  readonly outcome: 'success' | 'failure' | 'denied';
  readonly actor_type: 'user' | 'system' | 'emergency_admin' | 'demo';
  readonly actor_user_id: string | null;
}

export type GateBaseline = 'segment' | 'naive';
export const GATE_BASELINES: readonly GateBaseline[] = ['segment', 'naive'];

/** The challenger and the backtest gate baseline (settings). */
export interface ComparisonView {
  readonly champion: string;
  /** Null when none. */
  readonly challenger: string | null;
  readonly gateBaseline: GateBaseline;
  /** The registered models. */
  readonly models: readonly string[];
  /** Days each run covers, 7 to 30. */
  readonly horizonDays: number;
  /** Degradation also retrains. */
  readonly autoRetrain: boolean;
}

export const HORIZONS: readonly number[] = [7, 10, 14, 21, 28, 30];

export type ExperimentKind = 'backtest' | 'challenger' | 'retrain';
export type ExperimentTrigger = 'manual' | 'schedule' | 'degradation';
export type ExperimentStatus = 'running' | 'succeeded' | 'failed';

/** One tracked run (Experiments card). */
export interface ExperimentRow {
  readonly id: string;
  readonly kind: ExperimentKind;
  readonly trigger: ExperimentTrigger;
  readonly status: ExperimentStatus;
  readonly model: string;
  readonly challenger: string | null;
  readonly snapshot: string | null;
  readonly wape: number | null;
  readonly startedAt: string | null;
  readonly illustrative: boolean;
}

export interface ModelView {
  readonly versions: readonly VersionRow[];
  readonly activeVersion: string | null;
  /** The model of the last succeeded run when an engine made it; null for the placeholder. */
  readonly engineModel: string | null;
  readonly run: RunView | null;
  readonly pause: PauseView;
  readonly schedule: ScheduleView;
  /** The next retraining as a day and a time in Riyadh, or null for a manual cadence. */
  readonly nextRetraining: { readonly date: string; readonly time: string } | null;
  readonly clockStart: ClockStart;
  readonly planningLevel: PlanningLevel;
  readonly optimizerModel: OptimizerModel;
  /** Minutes per remote case: measured or fixed. */
  readonly remoteHandling: { readonly source: RemoteHandlingSource; readonly fixedMinutes: number };
  /** Null when the caller may not read it. */
  readonly comparison: ComparisonView | null;
  readonly reading: ReadingView | null;
  /** Null when the caller may not read them. */
  readonly assumptions: AssumptionsView | null;
  /** Recent changes, newest first; null when the caller may not read the audit log (the card is then left out). */
  readonly history: { readonly events: readonly HistoryEvent[]; readonly names: Readonly<Record<string, string>> } | null;
  /** Newest first; null when the caller may not read them. */
  readonly experiments: readonly ExperimentRow[] | null;
  readonly sources: readonly DataSource[];
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). No field here is a context, customer, user, role, zone scope or install
// mode. The version an action acts on is `versionId`; a note is what a person wrote.
// ---------------------------------------------------------------------------------------------

export interface SwitchVersion {
  readonly versionId: string;
  readonly reason: string;
}

export interface PauseNote {
  readonly reason: string;
}

export interface ScheduleInput {
  readonly cadence: string;
  readonly day_of_week: number | null;
  readonly time_of_day: string;
}

export interface ClockInput {
  readonly clock_start: string;
}

export interface LevelInput {
  readonly planning_level: string;
}

export interface OptimizerInput {
  readonly optimizer_model: string;
}

export interface RemoteHandlingInput {
  readonly handling_source?: string;
  readonly handling_fixed_minutes?: number;
}

export interface ChallengerInput {
  /** Empty or null for none. */
  readonly challenger_model: string | null;
}

export interface GateBaselineInput {
  readonly gate_baseline: string;
}

export interface HorizonInput {
  readonly horizon_days: number;
}

export interface AutoRetrainInput {
  readonly auto_retrain: boolean;
}

export interface RunOutcome {
  readonly runId: string;
  readonly model: string;
  readonly horizonStart: string;
  readonly horizonDays: number;
}

export interface StateOutcome {
  readonly paused: boolean;
  readonly active: string;
}
