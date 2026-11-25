// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { historyTitle, MARK, splitData } from './history';

describe('historyTitle', () => {
  it('reads an engine run', () => {
    expect(historyTitle('Forecast run for 10 day(s) from 2026-09-13 finished (engine 0.1.0, model seasonal-profile-1).')).toEqual({ key: 'run', vars: { model: 'seasonal-profile-1' } });
  });
  it('reads a placeholder run', () => {
    expect(historyTitle('Forecast run for 7 day(s) from 2026-09-13 finished (placeholder model placeholder-0.1, Illustrative).')).toEqual({ key: 'run', vars: { model: 'placeholder-0.1' } });
  });
  it('reads a switch, with or without a previous version', () => {
    expect(historyTitle('Forecast model b made active (was a).')).toEqual({ key: 'switched', vars: { from: 'a', to: 'b' } });
    expect(historyTitle('Forecast model b made active.')).toEqual({ key: 'switched', vars: { from: '', to: 'b' } });
    expect(historyTitle('Forecast model b made active (was ).')).toEqual({ key: 'switched', vars: { from: '', to: 'b' } });
  });
  it('reads pause, resume, schedule and the two settings', () => {
    expect(historyTitle('Forecast paused: holiday')?.key).toBe('paused');
    expect(historyTitle('Forecast resumed: ok')?.key).toBe('resumed');
    expect(historyTitle('Retraining schedule changed to weekly at 02:00.')).toEqual({ key: 'retrain', vars: { cad: 'weekly' } });
    expect(historyTitle('10-minute clock start changed from assignment to registration.')).toEqual({ key: 'clock', vars: { v: 'registration' } });
    expect(historyTitle('Planning level changed from zone to city.')).toEqual({ key: 'level', vars: { v: 'city' } });
    expect(historyTitle('Optimizer model changed from greedy-ls-0.3 to cpsat-1.')).toEqual({ key: 'optimizer', vars: { v: 'cpsat-1' } });
  });
  it('reads a challenger run, a backtest with and without a challenger, and a degradation', () => {
    expect(historyTitle('Challenger forecast run for 10 day(s) from 2026-09-13 finished (engine 0.4.0, model ensemble-2).')).toEqual({ key: 'challengerRun', vars: { model: 'ensemble-2' } });
    expect(historyTitle('Forecast backtest on 2026-08-16 to 2026-09-12 finished: pass (model ensemble-3, SYNTHETIC).')).toEqual({ key: 'backtest', vars: { model: 'ensemble-3' } });
    expect(historyTitle('Forecast backtest on 2026-08-16 to 2026-09-12 finished: pass (model ensemble-3, SYNTHETIC). Challenger ensemble-2 against ensemble-3: WAPE lift -2.1%, MAPE lift n/a.')).toEqual({
      key: 'lift',
      vars: { challenger: 'ensemble-2', champion: 'ensemble-3' },
    });
    expect(historyTitle('Forecast backtest on 2026-08-16 to 2026-09-12 finished: pass (model ensemble-3, SYNTHETIC). Challenger ensemble-2: no lift.')).toEqual({ key: 'lift', vars: { challenger: 'ensemble-2', champion: 'ensemble-3' } });
    expect(historyTitle('Forecast error above the limit in 2 zone(s) on 2026-09-12 (model ensemble-3, limit 40%).')).toEqual({ key: 'degraded', vars: { n: '2', model: 'ensemble-3' } });
    expect(historyTitle('Forecast error above the limit in 3 zone(s) over the 7 day(s) to 2026-09-12 (model ensemble-3, limit 40%).')).toEqual({ key: 'degraded', vars: { n: '3', model: 'ensemble-3' } });
  });
  it('reads a challenger the engine could not run (it fell back to the champion)', () => {
    expect(historyTitle('Challenger sarima-1 not stored: the engine ran ensemble-4.')).toEqual({ key: 'challengerSkipped', vars: { challenger: 'sarima-1', model: 'ensemble-4' } });
  });
  it('reads the calendar a run used, and an unknown one as a plain run', () => {
    expect(historyTitle('Forecast run for 10 day(s) from 2026-09-13 finished (engine 0.1.0, model seasonal-profile-1, calendar Customer Unified Planning Calendar).')).toEqual({
      key: 'runCal',
      vars: { model: 'seasonal-profile-1', calendar: 'customer' },
    });
    expect(historyTitle('Forecast run for 10 day(s) from 2026-09-13 finished (engine 0.1.0, model seasonal-profile-1, calendar derived from settings).')).toEqual({
      key: 'runCal',
      vars: { model: 'seasonal-profile-1', calendar: 'settings' },
    });
    expect(historyTitle('Challenger forecast run for 10 day(s) from 2026-09-13 finished (engine 0.4.0, model ensemble-2, calendar derived from settings).')).toEqual({
      key: 'challengerRunCal',
      vars: { model: 'ensemble-2', calendar: 'settings' },
    });
    expect(historyTitle('Forecast run for 10 day(s) from 2026-09-13 finished (engine 0.1.0, model m1, calendar something else).')).toEqual({ key: 'run', vars: { model: 'm1' } });
  });
  it('leaves other text to the screen', () => {
    expect(historyTitle('Forecast run for 3 day(s) from 2026-09-13 failed (timeout).')).toBeNull();
  });
});

describe('splitData', () => {
  it('marks the data parts', () => {
    expect(splitData(`Run (${MARK}m1${MARK})`)).toEqual([
      { text: 'Run (', data: false },
      { text: 'm1', data: true },
      { text: ')', data: false },
    ]);
  });
});

describe('the model comparison settings', () => {
  it('reads the challenger and the gate baseline', () => {
    expect(historyTitle('Challenger changed from none to sarima-1.')).toEqual({ key: 'challenger', vars: { model: 'sarima-1' } });
    expect(historyTitle('Challenger changed from sarima-1 to none.')).toEqual({ key: 'challengerOff', vars: {} });
    expect(historyTitle('Backtest gate baseline changed from segment to naive.')).toEqual({ key: 'gateBaseline', vars: { v: 'naive' } });
    expect(historyTitle('Challenger changed from none to ets-1. Backtest gate baseline changed from segment to naive.')).toBeNull();
  });
});

describe('the backtest start and failure', () => {
  it('reads both', () => {
    expect(historyTitle('Forecast backtest started (model ensemble-4).')).toEqual({ key: 'backtestStarted', vars: { model: 'ensemble-4' } });
    expect(historyTitle('Forecast backtest failed (timeout).')).toEqual({ key: 'backtestFailed', vars: { cls: 'timeout' } });
  });
});
