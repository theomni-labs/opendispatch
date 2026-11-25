// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Data Sources and Integrations screen: what the server side hands to the client
// files. JSON-safe (strings, numbers, booleans, arrays and objects of those). Nothing here is a context, a customer or the
// caller's role.

export type FeedKind = 'case_feed' | 'agent_feed' | 'assignment_channel' | 'weather_feed' | 'routing_feed' | 'other';
export type FeedHealth = 'healthy' | 'degraded' | 'down' | 'unknown' | 'disabled';
export type LiveStage = 'shadow' | 'recommend' | 'automatic';
export const STAGES: readonly LiveStage[] = ['shadow', 'recommend', 'automatic'];

export interface FeedView {
  readonly id: string;
  readonly kind: FeedKind;
  readonly name: string;
  readonly direction: 'inbound' | 'outbound';
  readonly enabled: boolean;
  /** Enabled, and not fed by the customer's live system. */
  readonly simulated: boolean;
  readonly health: FeedHealth;
  /** ISO 8601, or null when the feed never answered. */
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
  /** The data layer's English line for the last error. */
  readonly lastError: string | null;
  /** Assignment channel only: the timeout of the feed itself (null: it follows the fallback timeout). */
  readonly timeoutSeconds: number | null;
}

export interface ZoneRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly city: string;
  readonly stage: LiveStage;
  readonly updatedAt: string;
  /** The person who set the stage (a display name), or null when it was never set by hand. */
  readonly updatedBy: string | null;
}

export type FallbackStateName = 'armed' | 'active' | 'maintenance';
export type FallbackReason = 'none' | 'feed_outage' | 'health_check_failed' | 'maintenance' | 'manual' | 'opendispatch_timeout';

export interface FallbackView {
  readonly state: FallbackStateName;
  readonly reason: FallbackReason;
  readonly since: string | null;
  readonly lastSignal: 'fallback' | 'resume' | null;
  readonly lastSignalAt: string | null;
  readonly assignedCount: number;
}

export interface SourcesView {
  readonly feeds: readonly FeedView[];
  readonly zones: readonly ZoneRow[];
  readonly fallback: FallbackView;
  readonly timeoutSeconds: number;
  readonly deadlineMs: number;
  readonly suggestions: DispatchSuggestions;
  /** The data_source of every record shown. */
  readonly sources: readonly ('SYNTHETIC' | 'IMPORTED' | 'LIVE')[];
  readonly counts: { readonly healthy: number; readonly degraded: number; readonly off: number };
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). No field here is a context, customer, user, role, zone scope or install
// mode. The feed an action acts on is `integrationId`, the zone is `zoneId`; the stage is what a person chose.
// ---------------------------------------------------------------------------------------------

export interface FeedTarget {
  readonly integrationId: string;
}

export interface FeedSwitch {
  readonly integrationId: string;
  readonly enabled: boolean;
}

export interface StageChange {
  readonly zoneId: string;
  readonly stage: string;
  readonly reason: string;
}

export interface AllToShadow {
  readonly reason: string;
}

export interface FallbackSettings {
  readonly timeoutSeconds: number;
  readonly deadlineMs: number;
}

/** Dispatch suggestions. */
export interface DispatchSuggestions {
  readonly reposition: boolean;
  readonly maxMoveKm: number;
  readonly prayerPenalty: boolean;
}

export interface SignalRequest {
  readonly signal: string;
  readonly reason: string;
}

export interface MaintenanceSwitch {
  readonly enabled: boolean;
}

export interface FeedTestResult {
  readonly integrationId: string;
  readonly ok: boolean;
  readonly latencyMs: number | null;
}

export interface TestAllResult {
  readonly tested: number;
  readonly answered: number;
  readonly slow: number;
  readonly failed: number;
}

export interface StageChanged {
  readonly zoneId: string;
  readonly stage: LiveStage;
}

export interface AllShadowResult {
  readonly changed: number;
  readonly failed: number;
}

export interface FallbackChanged {
  readonly state: FallbackStateName;
}
