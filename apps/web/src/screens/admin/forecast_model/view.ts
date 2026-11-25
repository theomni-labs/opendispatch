// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Forecast and Model Admin screen: reads through lib/data with the request context and returns plain data
//. Not a Server Component and not an action: `Screen.tsx` calls it, the tests call it directly.
//
// Reads: listModelVersions and getModelState (this module), listForecastRuns (the latest run; it needs view on the Forecast
// Explorer), getSettingsSnapshot (clock start and planning level), listDashboardRollups (the 10-minute reading, both ways; it
// needs view on the Management Dashboards), listAuditEvents (Recent changes: the Administrator only) and listUserDisplayNames
// (who paused it, who did what). A read the caller may not make leaves that card out; it never fails the screen.
// THE FORECASTER IS A PLACEHOLDER: every figure is Illustrative.

import { actorNames } from '@/components/opendispatch/patterns/audit-actors';
import { nowIso } from '@/lib/data/context';
import { listAuditEvents } from '@/lib/data/audit';
import { listDashboardRollups } from '@/lib/data/dashboards';
import { ForbiddenError } from '@/lib/data/errors';
import { listForecastRuns } from '@/lib/data/forecast';
import type { RequestContext } from '@/lib/data/guard';
import { getSettingsSnapshot } from '@/lib/data/settings';
import { listForecastExperiments } from '@/lib/data/forecast-backtest';
import { getForecastModelSettings, getModelState, getWorkingAssumptions, listModelVersions } from '@/lib/data/models';
import { listUserDisplayNames } from '@/lib/data/users';
import { activeEngineModel, liftOf, versionRows } from './versions';
import type { DataSource, WorkingAssumptions } from '@/lib/types';
import { experimentRow } from './experiments';
import type { AssumptionsView, Cadence, ChallengerView, ComparisonView, HistoryEvent, ModelView, PauseView, ReadingView, RunView, ScheduleView } from './types';

const PAGE = 200;
/** What "Recent changes" lists: the model's own events, runs and the two measure settings. */
const HISTORY_PREFIXES = 'model.,forecast.,settings.clock_start,settings.planning_level,settings.optimizer_model';
const HISTORY_LIMIT = 6;
const EXPERIMENTS_LIMIT = 8;

async function tryOrAsync<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError) return fallback;
    throw error;
  }
}

const addDays = (day: string, days: number): string => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + days)).toISOString().slice(0, 10);
const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * The next retraining as a day and a time in Riyadh, from the day and the clock time now (`YYYY-MM-DD`, `HH:MM`): daily is the
 * next time of day that has not passed, weekly the next chosen weekday at that time, monthly 30 days on (the mockup's rule), and
 * manual has none. Pure: the clock is passed in.
 */
export function nextRetraining(schedule: ScheduleView, today: string, now: string): { date: string; time: string } | null {
  if (schedule.cadence === 'manual') return null;
  const passed = schedule.time <= now;
  if (schedule.cadence === 'daily') return { date: passed ? addDays(today, 1) : today, time: schedule.time };
  if (schedule.cadence === 'monthly') return { date: addDays(today, 30), time: schedule.time };
  const day = schedule.day ?? 0;
  let ahead = (day - weekdayOf(today) + 7) % 7;
  if (ahead === 0 && passed) ahead = 7;
  return { date: addDays(today, ahead), time: schedule.time };
}

/** The model of a succeeded run that an engine made; null for the placeholder. */
export function engineModelOf(run: { readonly status: string; readonly model_version: string } | undefined): string | null {
  return run !== undefined && run.status === 'succeeded' && !run.model_version.startsWith('placeholder') ? run.model_version : null;
}

function runView(run: Awaited<ReturnType<typeof listForecastRuns>>['items'][number]): RunView {
  return {
    id: run.id,
    status: run.status,
    model: run.model_version,
    engine: run.engine_version ?? null,
    ruleSet: run.rule_set_version ?? null,
    horizonStart: run.horizon_start_date,
    horizonDays: run.horizon_days,
    coverage: run.range_coverage,
    startedAt: run.started_at ?? null,
    finishedAt: run.finished_at ?? null,
    sources: run.input_data_sources ?? [],
    snapshot: run.dataset_snapshot_id ?? null,
  };
}


/** The comparison settings, null when unreadable. */
async function comparisonOf(ctx: RequestContext): Promise<ComparisonView | null> {
  const s = await tryOrAsync(() => getForecastModelSettings(ctx), null);
  if (s === null) return null;
  return { champion: s.champion_model, challenger: s.challenger_model ?? null, gateBaseline: s.gate_baseline, models: s.models, horizonDays: s.horizon_days ?? 10, autoRetrain: s.auto_retrain ?? true };
}

/** Challenger from settings, its run and lift. */
async function challengerOf(ctx: RequestContext, comparison: ComparisonView | null): Promise<ChallengerView | null> {
  const model = comparison?.challenger ?? null;
  if (model === null) return null;
  const runs = await tryOrAsync(async () => (await listForecastRuns(ctx, { limit: 20, status: 'succeeded' })).items, []);
  const backtest = await tryOrAsync(async () => (await listAuditEvents(ctx, { action_prefix: 'forecast.backtest', limit: 1 })).items[0], undefined);
  return { model, run: runs.find((run) => run.model_version === model), lift: liftOf(backtest?.detail, model) };
}

/** The latest kingdom roll-up as the 10-minute reading in both ways (the primary one comes from the clock setting, on the screen). */
async function readingOf(ctx: RequestContext): Promise<ReadingView | null> {
  const latest = await tryOrAsync(async () => (await listDashboardRollups(ctx, { level: 'kingdom', limit: 1 })).items[0], undefined);
  if (latest === undefined) return null;
  return { fromAssignment: latest.from_assignment.share, fromRegistration: latest.from_registration.share, illustrative: latest.illustrative };
}

/** The working assumptions as plain data. */
export function assumptionsView(a: WorkingAssumptions): AssumptionsView {
  return {
    liveSpeedKmh: a.live_travel_speed_kmh,
    planningSpeedKmh: a.planning_travel_speed_kmh,
    clockStart: a.clock_start,
    clockConfirmed: a.clock_start_confirmed,
    paydayDay: a.payday_day,
    handlingInferred: a.handling_inferred,
    caseSources: a.case_data_sources,
    weather: { source: a.weather.source, cities: a.weather.cities, from: a.weather.from ?? null, to: a.weather.to ?? null, attribution: a.weather.attribution ?? null },
    weatherFeed: a.weather_feed ?? 'none',
    trafficSource: a.traffic_source ?? 'none',
  };
}

export async function loadModelView(ctx: RequestContext): Promise<ModelView> {
  const versionList = (await listModelVersions(ctx, { limit: PAGE })).items;
  const state = await getModelState(ctx);
  const latest = await tryOrAsync(async () => (await listForecastRuns(ctx, { limit: 1 })).items[0], undefined);
  const succeeded = await tryOrAsync(async () => (await listForecastRuns(ctx, { limit: 1, status: 'succeeded' })).items[0], undefined);
  const comparison = await comparisonOf(ctx);
  const engineModel = activeEngineModel(engineModelOf(succeeded), comparison?.champion ?? null);
  const madeBy = succeeded?.model_version === engineModel ? succeeded : undefined;
  const versions = versionRows(versionList, engineModel, madeBy, await challengerOf(ctx, comparison));
  const snapshot = await getSettingsSnapshot(ctx);

  const pausedById = state.paused_by_user_id ?? null;
  const pausedBy = pausedById === null ? null : await tryOrAsync(async () => (await listUserDisplayNames(ctx, [pausedById])).items[0]?.display_name ?? null, null);
  const pause: PauseView = { paused: state.is_paused, pausedAt: state.paused_at ?? null, pausedBy, reason: state.pause_reason ?? null };
  const schedule: ScheduleView = { cadence: state.retraining_schedule.cadence as Cadence, day: state.retraining_schedule.day_of_week ?? null, time: state.retraining_schedule.time_of_day };

  const events = await tryOrAsync(async () => (await listAuditEvents(ctx, { action_prefix: HISTORY_PREFIXES, limit: HISTORY_LIMIT })).items, null);
  const history =
    events === null
      ? null
      : {
          events: events.map(
            (event): HistoryEvent => ({ id: event.id, action: event.action, summary_en: event.summary_en, occurred_at: event.occurred_at, outcome: event.outcome, actor_type: event.actor_type, actor_user_id: event.actor_user_id ?? null }),
          ),
          names: await tryOrAsync(() => actorNames(ctx, events), {} as Record<string, string>),
        };

  const clock = nowIso();
  const sources = [...new Set<DataSource>([state.data_source, ...(latest?.input_data_sources ?? []), ...versionList.map((row) => row.data_source), ...(events ?? []).map((event) => event.data_source)])];
  return {
    versions,
    activeVersion: engineModel ?? versions.find((row) => row.status === 'active')?.version ?? null,
    engineModel,
    run: latest === undefined ? null : runView(latest),
    pause,
    schedule,
    nextRetraining: nextRetraining(schedule, clock.slice(0, 10), clock.slice(11, 16)),
    clockStart: snapshot.clock_start,
    planningLevel: snapshot.planning_level,
    optimizerModel: snapshot.optimizer_model ?? 'cpsat-1',
    remoteHandling: { source: snapshot.remote_handling_source ?? 'measured', fixedMinutes: snapshot.remote_handling_fixed_minutes ?? 31.5 },
    comparison,
    reading: await readingOf(ctx),
    assumptions: await tryOrAsync(async () => assumptionsView(await getWorkingAssumptions(ctx)), null),
    history,
    experiments: await tryOrAsync(async () => (await listForecastExperiments(ctx, { limit: EXPERIMENTS_LIMIT })).items.map(experimentRow), null),
    sources,
  };
}
