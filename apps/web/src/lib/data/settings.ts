// SPDX-License-Identifier: AGPL-3.0-only
// Settings: thin client; Go owns the values.

import type { ClockStart, OverrideReasonCode, PageInfo, PlanningLevel, Setting, SettingsSnapshot, ZoneStage } from '@/lib/types';
import { requirePlatform, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { pathSegment } from './internal/path-segment';

export const CLOCK_STARTS = ['assignment', 'registration'] as const satisfies readonly ClockStart[];
export const PLANNING_LEVELS = ['zone', 'sub_zone', 'city'] as const satisfies readonly PlanningLevel[];

export interface PrimaryReading<T> {
  /** Which reading is primary (the setting). */
  readonly clock_start: ClockStart;
  readonly primary: T;
  readonly secondary: T;
  /** Rule 7: both readings are always shown; these are their labels' keys. */
  readonly primary_key: 'from_assignment' | 'from_registration';
  readonly secondary_key: 'from_assignment' | 'from_registration';
}

/**
 * The primary reading of the 10-minute measure. Pure: pass the setting (getClockStart) and both readings.
 * The other one is `secondary`, shown beside it, never dropped.
 * @pure
 */
export function primaryReading<T>(clockStart: ClockStart, both: { readonly from_registration: T; readonly from_assignment: T }): PrimaryReading<T> {
  return clockStart === 'registration'
    ? { clock_start: 'registration', primary: both.from_registration, secondary: both.from_assignment, primary_key: 'from_registration', secondary_key: 'from_assignment' }
    : { clock_start: 'assignment', primary: both.from_assignment, secondary: both.from_registration, primary_key: 'from_assignment', secondary_key: 'from_registration' };
}

// ---------------------------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------------------------

// operationId: getSettingsSnapshot
export async function getSettingsSnapshot(ctx: RequestContext): Promise<SettingsSnapshot> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<SettingsSnapshot>(ctx, '/settings'))!;
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

// operationId: updateClockStart
export async function updateClockStart(ctx: RequestContext, body: unknown): Promise<SettingsSnapshot> {
  return (await businessFetch<SettingsSnapshot>(ctx, '/settings/clock-start', { method: 'PUT', body }))!;
}

// operationId: updatePlanningLevel
export async function updatePlanningLevel(ctx: RequestContext, body: unknown): Promise<SettingsSnapshot> {
  return (await businessFetch<SettingsSnapshot>(ctx, '/settings/planning-level', { method: 'PUT', body }))!;
}

// operationId: updateOptimizerModel
export async function updateOptimizerModel(ctx: RequestContext, body: unknown): Promise<SettingsSnapshot> {
  return (await businessFetch<SettingsSnapshot>(ctx, '/settings/optimizer-model', { method: 'PUT', body }))!;
}

// operationId: updateRemoteHandling
export async function updateRemoteHandling(ctx: RequestContext, body: unknown): Promise<SettingsSnapshot> {
  return (await businessFetch<SettingsSnapshot>(ctx, '/settings/remote-handling', { method: 'PUT', body }))!;
}

// operationId: updateBreakPrayerPolicy
export async function updateBreakPrayerPolicy(ctx: RequestContext, body: unknown): Promise<SettingsSnapshot> {
  return (await businessFetch<SettingsSnapshot>(ctx, '/settings/break-prayer', { method: 'PUT', body }))!;
}

// operationId: updateLiveAssignmentSettings
export async function updateLiveAssignmentSettings(ctx: RequestContext, body: unknown): Promise<SettingsSnapshot> {
  return (await businessFetch<SettingsSnapshot>(ctx, '/settings/live-assignment', { method: 'PUT', body }))!;
}

// operationId: setZoneStage
export async function setZoneStage(ctx: RequestContext, zoneId: string, body: unknown): Promise<ZoneStage> {
  return (await businessFetch<ZoneStage>(ctx, `/settings/live-assignment/stages/${pathSegment(zoneId)}`, { method: 'PUT', body }))!;
}

// ---------------------------------------------------------------------------------------------
// Vocabularies the screens need, and the raw settings list
// ---------------------------------------------------------------------------------------------

export interface ReasonCodeInfo {
  readonly code: OverrideReasonCode;
  readonly name_en: string;
  readonly name_ar: string | null;
  /** True for `other`: a note is required. */
  readonly requires_note: boolean;
}

/** The override reason codes with their labels, for the override dialog of the Live Dispatch Board and the roster overrides. */
// operationId: (not in the contract) getOverrideReasonCodes
export async function getOverrideReasonCodes(ctx: RequestContext): Promise<readonly ReasonCodeInfo[]> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<ReasonCodeInfo[]>(ctx, '/settings/reason-codes')) ?? [];
}

export interface SkillInfo {
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string | null;
}

/** The skills vocabulary (invented, none is standard) that the agent screens offer. Skill codes remain free strings. */
// operationId: (not in the contract) getSkillVocabulary
export async function getSkillVocabulary(ctx: RequestContext): Promise<readonly SkillInfo[]> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<SkillInfo[]>(ctx, '/settings/skills')) ?? [];
}

/** Every stored setting, as the Administrator sees them (Admin 9 shows and edits the live-assignment ones). */
// operationId: (not in the contract) listSettings
export async function listSettings(ctx: RequestContext, query: PageQuery = {}): Promise<{ items: Setting[]; page: PageInfo }> {
  const qs = [query.limit === undefined ? '' : `limit=${query.limit}`, query.cursor === undefined ? '' : `cursor=${encodeURIComponent(query.cursor)}`].filter((p) => p !== '').join('&');
  return (await businessFetch<{ items: Setting[]; page: PageInfo }>(ctx, `/settings/all${qs === '' ? '' : `?${qs}`}`))!;
}

/**
 * The demo "today" (setting `demo.today`, for a screen that needs to default a date near it (Field Planner
 * Workbench, Forecast Explorer). PHASE A DEMO TOOLING, not a contract operation, like the `?state=` review hook: the
 * screen never shows this string, only uses it to pick a sensible date and zone to open.
 */
// operationId: (not in the contract) getDemoToday
export async function getDemoToday(ctx: RequestContext): Promise<string> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<{ date: string }>(ctx, '/settings/demo-today'))!.date;
}
