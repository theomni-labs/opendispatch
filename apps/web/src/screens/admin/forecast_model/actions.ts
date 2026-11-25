'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Forecast and Model Admin screen: exactly the data functions named here.
//
//   runForecast          createForecastRun            (the placeholder forecaster answers at once; Illustrative)
//   switchVersion        switchModelVersion           (a reason is written; the Administrator and the Planner are notified)
//   pauseForecast        pauseModel                   (a reason is written; raises the alert that shows in the bell and Notifications)
//   resumeForecast       resumeModel
//   saveSchedule         updateRetrainingSchedule
//   changeClockStart     updateClockStart             (assignment or registration: the primary one of the 10-minute measure)
//   changePlanningLevel  updatePlanningLevel
//   changeOptimizer      updateOptimizerModel
//   changeRemoteHandling updateRemoteHandling         (measured or fixed minutes per remote case)
//   changeChallenger     updateForecastModelSettings  (the challenger, or none)
//   changeGateBaseline   updateForecastModelSettings  (what the backtest gate compares with)
//   changeHorizon        updateForecastModelSettings  (the days each run covers, 7 to 30)
//   changeAutoRetrain    updateForecastModelSettings  (degradation also retrains)
//   retrainNow           retrainForecastModel         (refit and backtest in the background;)
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. A version is a
// `versionId`. A caller who may not write is refused, and audited as denied, by Go's check of the write, also where the action
// reads first (the horizon of a new run). (tools/rules/context-rules.test.ts scans this file for those names.)

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { nowIso } from '@/lib/data/context';
import { ForbiddenError } from '@/lib/data/errors';
import { listForecastRuns } from '@/lib/data/forecast';
import { retrainForecastModel, runForecastBacktest } from '@/lib/data/forecast-backtest';
import { createForecastRun, getForecastModelSettings, getModelState, pauseModel, resumeModel, switchModelVersion, updateForecastModelSettings, updateRetrainingSchedule } from '@/lib/data/models';
import { updateClockStart, updateOptimizerModel, updatePlanningLevel, updateRemoteHandling } from '@/lib/data/settings';
import type { AutoRetrainInput, ChallengerInput, ClockInput, GateBaselineInput, HorizonInput, LevelInput, OptimizerInput, PauseNote, RemoteHandlingInput, RunOutcome, ScheduleInput, StateOutcome, SwitchVersion } from './types';

const REVALIDATE = '/admin/forecast-model';
const DAY_MS = 86_400_000;

const stateOf = async (ctx: Parameters<typeof getModelState>[0]): Promise<StateOutcome> => {
  const state = await getModelState(ctx);
  return { paused: state.is_paused, active: state.active_version };
};

/**
 * Runs the forecast again from the start day of the latest run (or the day after today when there is none) for the configured
 * horizon (forecast.horizon_days), or the latest run's length when the settings cannot be read.
 */
export async function runForecast(): Promise<ActionResult<RunOutcome>> {
  return runAction(
    async (ctx) => {
      // a refused read still reaches the audited write
      const latest = await listForecastRuns(ctx, { limit: 1 }).then(
        (runs) => runs.items[0],
        (error: unknown) => {
          if (error instanceof ForbiddenError) return undefined;
          throw error;
        },
      );
      const tomorrow = new Date(Date.parse(nowIso()) + DAY_MS).toISOString().slice(0, 10);
      const configured = await getForecastModelSettings(ctx).then(
        (s) => s.horizon_days,
        (error: unknown) => {
          if (error instanceof ForbiddenError) return undefined;
          throw error;
        },
      );
      const run = await createForecastRun(ctx, { horizon_start_date: latest?.horizon_start_date ?? tomorrow, horizon_days: configured ?? latest?.horizon_days ?? 1 });
      return { runId: run.id, model: run.model_version, horizonStart: run.horizon_start_date, horizonDays: run.horizon_days } satisfies RunOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

export async function switchVersion(input: SwitchVersion): Promise<ActionResult<StateOutcome>> {
  return runAction(
    async (ctx) => {
      await switchModelVersion(ctx, pickText(input, 'versionId') ?? '', { reason: pickText(input, 'reason') });
      return stateOf(ctx);
    },
    { revalidate: REVALIDATE },
  );
}

export async function pauseForecast(input: PauseNote): Promise<ActionResult<StateOutcome>> {
  return runAction(
    async (ctx) => {
      await pauseModel(ctx, { reason: pickText(input, 'reason') });
      return stateOf(ctx);
    },
    { revalidate: REVALIDATE },
  );
}

export async function resumeForecast(input: PauseNote): Promise<ActionResult<StateOutcome>> {
  return runAction(
    async (ctx) => {
      await resumeModel(ctx, { reason: pickText(input, 'reason') });
      return stateOf(ctx);
    },
    { revalidate: REVALIDATE },
  );
}

/** Cadence, day (weekly only) and time of day (`HH:MM`). */
export async function saveSchedule(input: ScheduleInput): Promise<ActionResult<StateOutcome>> {
  return runAction(
    async (ctx) => {
      await updateRetrainingSchedule(ctx, pickFields(input, ['cadence', 'day_of_week', 'time_of_day']));
      return stateOf(ctx);
    },
    { revalidate: REVALIDATE },
  );
}

/** From assignment or from registration: the primary reading of the 10-minute measure (both are always shown). */
export async function changeClockStart(input: ClockInput): Promise<ActionResult<{ clockStart: string }>> {
  return runAction(
    async (ctx) => {
      const saved = await updateClockStart(ctx, pickFields(input, ['clock_start']));
      return { clockStart: saved.clock_start };
    },
    { revalidate: REVALIDATE },
  );
}

export async function changePlanningLevel(input: LevelInput): Promise<ActionResult<{ planningLevel: string }>> {
  return runAction(
    async (ctx) => {
      const saved = await updatePlanningLevel(ctx, pickFields(input, ['planning_level']));
      return { planningLevel: saved.planning_level };
    },
    { revalidate: REVALIDATE },
  );
}

/** The model each roster build asks for. */
export async function changeOptimizer(input: OptimizerInput): Promise<ActionResult<{ optimizerModel: string }>> {
  return runAction(
    async (ctx) => {
      const saved = await updateOptimizerModel(ctx, pickFields(input, ['optimizer_model']));
      return { optimizerModel: saved.optimizer_model ?? 'cpsat-1' };
    },
    { revalidate: REVALIDATE },
  );
}

/** Minutes per remote case for remote staffing. */
export async function changeRemoteHandling(input: RemoteHandlingInput): Promise<ActionResult<{ source: string; fixedMinutes: number }>> {
  return runAction(
    async (ctx) => {
      const saved = await updateRemoteHandling(ctx, pickFields(input, ['handling_source', 'handling_fixed_minutes']));
      return { source: saved.remote_handling_source ?? 'measured', fixedMinutes: saved.remote_handling_fixed_minutes ?? 31.5 };
    },
    { revalidate: REVALIDATE },
  );
}

/** The challenger: one of the registered models, or none (empty or null). */
export async function changeChallenger(input: ChallengerInput): Promise<ActionResult<{ challenger: string | null }>> {
  return runAction(
    async (ctx) => {
      const model = pickText(input, 'challenger_model') ?? '';
      const saved = await updateForecastModelSettings(ctx, { challenger_model: model === '' ? null : model });
      return { challenger: saved.challenger_model ?? null };
    },
    { revalidate: REVALIDATE },
  );
}

export async function changeGateBaseline(input: GateBaselineInput): Promise<ActionResult<{ gateBaseline: string }>> {
  return runAction(
    async (ctx) => {
      const saved = await updateForecastModelSettings(ctx, pickFields(input, ['gate_baseline']));
      return { gateBaseline: saved.gate_baseline };
    },
    { revalidate: REVALIDATE },
  );
}

/** The days each forecast run covers (7 to 30). */
export async function changeHorizon(input: HorizonInput): Promise<ActionResult<{ horizonDays: number }>> {
  return runAction(
    async (ctx) => {
      const saved = await updateForecastModelSettings(ctx, pickFields(input, ['horizon_days']));
      return { horizonDays: saved.horizon_days ?? 10 };
    },
    { revalidate: REVALIDATE },
  );
}

/** Whether an accuracy drop also retrains. */
export async function changeAutoRetrain(input: AutoRetrainInput): Promise<ActionResult<{ autoRetrain: boolean }>> {
  return runAction(
    async (ctx) => {
      const saved = await updateForecastModelSettings(ctx, pickFields(input, ['auto_retrain']));
      return { autoRetrain: saved.auto_retrain ?? true };
    },
    { revalidate: REVALIDATE },
  );
}

// Refit and backtest in the background
export async function retrainNow(): Promise<ActionResult<{ experimentId: string }>> {
  return runAction(
    async (ctx) => {
      const started = await retrainForecastModel(ctx);
      return { experimentId: started.id };
    },
    { revalidate: REVALIDATE },
  );
}

// Administrator only; Go audits it
export async function startBacktest(): Promise<ActionResult<{ running: boolean }>> {
  return runAction(
    async (ctx) => {
      const state = await runForecastBacktest(ctx);
      return { running: state.run.state === 'running' };
    },
    { revalidate: REVALIDATE },
  );
}
