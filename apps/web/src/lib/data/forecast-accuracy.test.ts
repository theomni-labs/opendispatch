// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from './errors';
import { getRollingForecastAccuracy } from './forecast-accuracy';
import { ctxFor, expectValid, withTempDemoState } from './test-support';

withTempDemoState();

describe('the rolling forecast accuracy', () => {
  it('reads for the Administrator, valid against the contract, with the default settings', async () => {
    const got = await getRollingForecastAccuracy(ctxFor('administrator'));
    expectValid('RollingForecastAccuracy', got);
    expect(got.window_days).toBe(28);
    expect(got.mape_target).toBe(0.15);
    expect(got.illustrative).toBe(true);
  });

  it('is the Administrator only', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      await expect(getRollingForecastAccuracy(ctxFor(role))).rejects.toThrow(ForbiddenError);
    }
  });
});
