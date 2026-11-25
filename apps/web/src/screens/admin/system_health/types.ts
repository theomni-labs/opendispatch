// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the System Health screen: what the server side hands to the client files.
// Everything here is JSON-safe. Nothing here is a context, a customer or the caller's role.

export const TABS = ['overview', 'jobs', 'storage'] as const;
export type Tab = (typeof TABS)[number];

export const JOB_STATUSES = ['succeeded', 'failed'] as const;
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export const JOB_KINDS = ['forecast', 'rollup', 'roster', 'import', 'assignment', 'retention'] as const;
export type JobKind = (typeof JOB_KINDS)[number] | 'other';

export type Overall = 'healthy' | 'degraded' | 'down';
export type ServiceName = 'web' | 'api' | 'worker' | 'engines' | 'database' | 'keycloak' | 'object_storage' | 'update_agent';
export type ServiceStatus = 'ok' | 'degraded' | 'down' | 'unknown';
export type FeedHealth = 'healthy' | 'degraded' | 'down' | 'unknown' | 'disabled';

export interface ServiceRow {
  readonly name: ServiceName;
  readonly status: ServiceStatus;
}

export interface FeedRow {
  readonly id: string;
  /** The feed's kind (`case_feed`), which the screen translates the name of. */
  readonly kind: string;
  readonly name: string;
  readonly direction: 'inbound' | 'outbound';
  readonly health: FeedHealth;
  readonly lastSuccessAt: string | null;
  /** The data layer's English error text of a feed that is not healthy, or null. */
  readonly error: string | null;
  /** The weather row only: what the forecaster reads. */
  readonly weather: WeatherSource | null;
}

/** Stored weather_days rows, or a configured feed. */
export type WeatherSource = { readonly kind: 'stored'; readonly to: string | null; readonly source: string | null } | { readonly kind: 'feed' };

export interface JobRow {
  readonly id: string;
  readonly name: string;
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly startedAt: string | null;
  readonly durationMs: number | null;
  readonly message: string | null;
}

export const ENGINE_NAMES = ['forecaster', 'optimizer', 'simulator', 'assignment'] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];
export type BreakerState = 'closed' | 'half_open' | 'open';

/** One engine row; counts since the api started. */
export interface EngineRow {
  readonly engine: EngineName;
  readonly mode: 'fixture' | 'engine';
  readonly breaker: BreakerState;
  readonly calls: number;
  readonly failures: number;
  readonly timeouts: number;
  readonly rejected: number;
  readonly breakerOpens: number;
  /** Answers from the fixture, engine could not answer. */
  readonly fixtureAnswers: number;
  readonly modelVersion: string | null;
  readonly lastFailureAt: string | null;
}

/** The Engines card's data, read on its own. */
export type EnginesView =
  | { readonly status: 'error' }
  | { readonly status: 'ok'; readonly asOf: string; readonly stale: boolean; readonly rows: readonly EngineRow[] };

export interface StorageArea {
  readonly area: 'import_files' | 'exports' | 'backups' | 'other';
  readonly usedBytes: number;
}

export interface StorageView {
  readonly usedBytes: number;
  readonly totalBytes: number;
  readonly areas: readonly StorageArea[];
}

export interface BackupView {
  /** ISO 8601, or null when no backup was ever confirmed. */
  readonly lastConfirmedAt: string | null;
  readonly confirmedBy: string | null;
  readonly source: 'customer_reported' | 'automatic' | 'none';
  /** YYYY-MM-DD, or null. */
  readonly restoreDrillDue: string | null;
  readonly overdue: boolean;
}

export interface VersionView {
  readonly current: string;
  readonly channel: 'stable' | 'hotfix' | null;
  /** The update agent's version: private installs only (the agent is the customer's there). */
  readonly agent: string | null;
  readonly installMode: 'private' | 'dedicated' | 'shared';
}

/** What the diagnostics file holds, shown before anything is created. */
export interface DiagnosticsPreview {
  readonly settings: readonly { readonly key: string; readonly value: string }[];
  readonly services: number;
  readonly feeds: number;
  readonly jobs: number;
}

// What the browser sends to the actions (actions.ts): nothing. Both writes take no argument at all.

// What the actions give back.
export interface BackupConfirmed {
  readonly confirmedAt: string;
}

/** The diagnostics archive, base64 encoded so the result stays JSON. It holds settings, health and job runs, never case or personal data. */
export interface DiagnosticsFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly contentBase64: string;
  readonly sizeBytes: number;
}
