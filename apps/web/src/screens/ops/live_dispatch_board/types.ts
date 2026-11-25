// SPDX-License-Identifier: AGPL-3.0-only
// View types for Live Dispatch Board, untranslated.

import type { CaseClassification, CaseEta, CasePick, CaseReason } from '@/components/opendispatch/LiveCaseCard';
import type { MapLink, MapPin, MapZone } from '@/components/opendispatch/MapView';
import type { ShadowComparisonRow } from '@/components/opendispatch/ShadowComparisonList';
import type { AgentStatusLegendItem } from '@/components/opendispatch/AgentStatusLegend';
import type { ClockStart, DataSource, LiveStage, OverrideReasonCode } from '@/lib/types';

/** The mockup's six reason codes, in the order the drawer lists them (dispatch.ts REASON_CODES). */
export const REASON_CODES = ['agent_unavailable', 'vehicle_unavailable', 'closer_agent_known', 'skills_needed', 'dispatcher_judgement', 'other'] as const satisfies readonly OverrideReasonCode[];

export type BoardColumn = 'waiting' | 'recommended' | 'assigned' | 'enroute' | 'onscene';
export const BOARD_COLUMNS = ['waiting', 'recommended', 'assigned', 'enroute', 'onscene'] as const satisfies readonly BoardColumn[];

/** The three columns drawn: assigned, en route and on scene share In progress. */
export type DisplayColumn = 'waiting' | 'recommended' | 'progress';
export const DISPLAY_COLUMNS = ['waiting', 'recommended', 'progress'] as const satisfies readonly DisplayColumn[];
export type ProgressState = 'assigned' | 'enroute' | 'onscene';
export const PROGRESS_STATES = ['assigned', 'enroute', 'onscene'] as const satisfies readonly ProgressState[];

/** The board's tabs, the `tab` search parameter. */
export const BOARD_TABS = ['board', 'map', 'spots', 'reach', 'shadow'] as const;
export type BoardTab = (typeof BOARD_TABS)[number];

export interface OverrideOption {
  readonly agentId: string;
  readonly name: string;
  readonly minutes: number;
}

export interface CaseCardView {
  readonly caseId: string;
  readonly caseNumber: string;
  readonly zoneCode: string;
  /** Registered time, already formatted ("10:33"; locale-independent). */
  readonly time: string;
  readonly parties: number;
  /** The zone's live stage (a setting). */
  readonly stage: LiveStage;
  readonly waitMinutes?: number | undefined;
  readonly pick?: CasePick | undefined;
  readonly eta?: CaseEta | undefined;
  readonly reason?: CaseReason | undefined;
  /** The rules' answer, when the api sent one. */
  readonly classification?: CaseClassification | undefined;
  /** The latest AI suggestion, in brief (never routes). */
  readonly ai?: { readonly handling: 'field' | 'remote_inferred'; readonly pct: number } | undefined;
  /** True only for state `recommended`: Accept and Override show. */
  readonly canDecide: boolean;
  /** The recommended agent's id, for Accept's body. Present only when canDecide. */
  readonly recommendedAgentId?: string | undefined;
  /** Nearest available agent beyond the 10-minute threshold. */
  readonly overReach?: boolean | undefined;
  /** Alternative candidates for Override, the ranking minus the top pick. Present only when canDecide. */
  readonly overrideOptions?: readonly OverrideOption[] | undefined;
}

export interface StageRow {
  readonly zoneId: string;
  readonly zoneCode: string;
  readonly stage: LiveStage;
}

export interface FallbackView {
  /** `armed`, `active` or `maintenance` (FallbackState.state); the banner is active whenever it is not `armed`. */
  readonly active: boolean;
  /** Why it is active (FallbackState.reason); the banner names this cause, never a feed outage by default. */
  readonly reason: 'none' | 'feed_outage' | 'health_check_failed' | 'maintenance' | 'manual' | 'opendispatch_timeout';
  /** Clock time the fallback became active, formatted; null while armed or unknown. */
  readonly sinceTime: string | null;
  readonly timeoutSeconds: number;
  readonly count: number;
}

export interface ReplayView {
  readonly status: 'stopped' | 'playing' | 'paused' | 'finished';
  /** The replay day, Gregorian with Hijri as the secondary calendar, in the page's language. */
  readonly dateBoth: string;
  /** The replay clock's time of day, formatted (locale-independent). */
  readonly time: string;
  readonly deliveredCases: number;
  readonly totalCases: number;
  /** The simulated feed outage alone; fallback may be active for another cause. */
  readonly feedOutageActive: boolean;
}

export interface MapDataView {
  readonly zones: readonly MapZone[];
  readonly pins: readonly MapPin[];
  readonly links: readonly MapLink[];
  readonly legend: readonly AgentStatusLegendItem[];
  /** Waiting spots are drawn: the legend explains them. */
  readonly spots: boolean;
}

/** One suggested waiting spot (advisory, never an assignment). */
export interface WaitingSpotRowView {
  readonly agentId: string;
  readonly name: string;
  readonly zoneCode: string;
  readonly moveKm: number;
  readonly reason: 'cover_expected_demand' | 'rebalance_zone';
}

export interface WaitingSpotsView {
  /** The setting dispatch.reposition; off hides the card. */
  readonly enabled: boolean;
  readonly illustrative: boolean;
  readonly generatedAt: string | null;
  readonly rows: readonly WaitingSpotRowView[];
}

export interface ReadingSideView {
  readonly fromAssignment: number | null;
  readonly fromRegistration: number | null;
}

export interface ReadingPanelView {
  readonly clockStart: ClockStart;
  readonly illustrative: boolean;
  readonly customer: ReadingSideView;
  readonly opendispatch: ReadingSideView;
  readonly casesCompared: number;
  /** The comparison window, already formatted dates (locale-aware, built with the page's language). */
  readonly fromDate: string;
  readonly toDate: string;
}

export interface UnmetRowView {
  readonly caseId: string;
  readonly caseNumber: string;
  readonly zoneId: string;
  readonly zoneCode: string;
  readonly time: string;
  readonly nearestName: string | null;
  readonly travelMinutes: number | null;
  readonly cause: 'geography' | 'people';
}

/** Cases out of 10-minute reach, for one day. */
export interface UnmetView {
  readonly day: string;
  readonly boardDay: string;
  readonly dayOptions: readonly string[];
  readonly zoneOptions: readonly { readonly value: string; readonly label: string }[];
  readonly rows: readonly UnmetRowView[];
  readonly thresholdMinutes: number;
}

export interface LiveDispatchView {
  readonly replay: ReplayView;
  readonly fallback: FallbackView;
  readonly stages: readonly StageRow[];
  readonly columns: Readonly<Record<BoardColumn, readonly CaseCardView[]>>;
  readonly totalCases: number;
  /** Cases out of 10-minute reach on the board's day. */
  readonly overReachToday: number;
  readonly map: MapDataView;
  readonly reading: ReadingPanelView;
  readonly comparisons: readonly ShadowComparisonRow[];
  readonly sources: readonly DataSource[];
  readonly unmet: UnmetView;
  readonly waiting: WaitingSpotsView;
}
