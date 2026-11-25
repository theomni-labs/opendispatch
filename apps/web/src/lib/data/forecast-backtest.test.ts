// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit';
import { ConflictError, ForbiddenError, InvalidInputError } from './errors';
import { getForecastAccuracy, getForecastBacktest, runForecastBacktest } from './forecast-backtest';
import { ctxFor, expectValid, fixtureZoneIds, withTempDemoState } from './test-support';

withTempDemoState();

const admin = () => ctxFor('administrator');

describe('the forecast backtest', () => {
  it('reads the state for the Administrator, valid against the contract', async () => {
    const state = await getForecastBacktest(admin());
    expectValid('ForecastBacktestState', state);
    expect(state.active_model).not.toBe('');
  });

  it('is the Administrator only: other roles get forbidden, and a refused run is audited', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor'] as const) {
      await expect(getForecastBacktest(ctxFor(role))).rejects.toThrow(ForbiddenError);
    }
    await expect(runForecastBacktest(ctxFor('planner'))).rejects.toThrow(ForbiddenError);
    const denied = (await listAuditEvents(admin(), { action: 'forecast.backtest_run', outcome: 'denied' })).items;
    expect(denied.length).toBeGreaterThan(0);
  });

  it('refuses a run without the forecaster engine, as a conflict', async () => {
    await expect(runForecastBacktest(admin())).rejects.toThrow(ConflictError);
  });
});

describe('forecast against actual', () => {
  it('answers every Forecast Explorer role, valid against the contract', async () => {
    for (const role of ['administrator', 'planner', 'viewer_auditor'] as const) {
      const got = await getForecastAccuracy(ctxFor(role));
      expectValid('ForecastAccuracy', got);
      expect(Array.isArray(got.dates)).toBe(true);
    }
    await expect(getForecastAccuracy(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
  });

  it('checks the day and the zone', async () => {
    await expect(getForecastAccuracy(admin(), { date: '14-09-2026' })).rejects.toThrow(InvalidInputError);
    const got = await getForecastAccuracy(admin(), { zone_id: fixtureZoneIds()[0] });
    expectValid('ForecastAccuracy', got);
  });
});
