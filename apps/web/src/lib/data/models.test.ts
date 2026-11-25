// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/lib/types';
import { listAuditEvents } from './audit';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { listForecastRuns } from './forecast';
import {
  createForecastRun,
  getForecastModelSettings,
  getModelState,
  getWorkingAssumptions,
  listModelVersions,
  pauseModel,
  resumeModel,
  switchModelVersion,
  updateClockStart,
  updateForecastModelSettings,
  updatePlanningLevel,
  updateRetrainingSchedule,
} from './models';
import { ctxFor, expectValid, withTempDemoState } from './test-support';

withTempDemoState();

const admin = () => ctxFor('administrator');

async function modelNotifications(): Promise<Notification[]> {
  const res = await fetch(`${process.env['OPENDISPATCH_API_URL']}/_internal/test/notifications`);
  return ((await res.json()) as Notification[]).filter((n) => n.category === 'model');
}

async function auditOf(action: string, outcome: 'success' | 'denied' = 'success') {
  return (await listAuditEvents(admin(), { action, outcome })).items;
}

describe('reading the model admin', () => {
  it('lists the versions and the state, and validates against the contract', async () => {
    const list = await listModelVersions(admin());
    expect(list.items.map((m) => m.version).sort()).toEqual(['ensemble-3', 'ensemble-4']);
    expect(list.items.every((m) => !m.is_placeholder)).toBe(true);
    expectValid('ModelVersionList', list);
    const state = await getModelState(admin());
    expect(state).toMatchObject({ active_version: 'ensemble-4', is_paused: false, data_source: 'SYNTHETIC' });
    expect(state.last_forecast_run_id).toEqual(expect.any(String));
    expectValid('ModelState', state);
    const assumed = await getWorkingAssumptions(admin());
    expect(assumed).toMatchObject({ live_travel_speed_kmh: 35, planning_travel_speed_kmh: 40, clock_start: 'assignment', clock_start_confirmed: true, payday_day: 27, handling_inferred: true });
    expect(assumed.case_data_sources).toContain('SYNTHETIC');
    expectValid('WorkingAssumptions', assumed);
  });

  it('is for the Administrator only', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      await expect(getModelState(ctxFor(role))).rejects.toThrow(ForbiddenError);
      await expect(getWorkingAssumptions(ctxFor(role))).rejects.toThrow(ForbiddenError);
      await expect(listModelVersions(ctxFor(role))).rejects.toThrow(ForbiddenError);
    }
  });
});

describe('flow 7: switch the version, pause it, an alert appears', () => {
  it('switches the active version, retires the old one and tells the Administrator and Planner', async () => {
    const candidate = (await listModelVersions(admin())).items.find((m) => m.version === 'ensemble-3');
    expect(candidate?.status).toBe('retired');
    const state = await switchModelVersion(admin(), candidate?.id ?? '', { reason: 'Try the previous model on Monday.' });
    expect(state.active_version).toBe(candidate?.version);
    const after = (await listModelVersions(admin())).items;
    expect(after.filter((m) => m.status === 'active').map((m) => m.version)).toEqual([candidate?.version]);
    expect(after.find((m) => m.version === 'ensemble-4')?.status).toBe('retired');
    expect((await auditOf('model.version_switched'))[0]?.detail).toMatchObject({ from: 'ensemble-4', to: candidate?.version });
    const alerts = (await modelNotifications()).filter((n) => n.title_en === 'Forecast model switched');
    expect(alerts.map((n) => n.recipient_role).sort()).toEqual(['administrator', 'planner']);
    expect(alerts.every((n) => n.severity === 'info' && n.is_read === false)).toBe(true);
  });

  it('can switch back to an older version and refuses a version that is already active', async () => {
    const byVersion = async (v: string) => (await listModelVersions(admin())).items.find((m) => m.version === v);
    expect((await switchModelVersion(admin(), (await byVersion('ensemble-3'))?.id ?? '', { reason: 'Try it.' })).active_version).toBe('ensemble-3');
    const older = await byVersion('ensemble-4');
    expect(older?.status).toBe('retired');
    expect((await switchModelVersion(admin(), older?.id ?? '', { reason: 'Rollback.' })).active_version).toBe('ensemble-4');
    await expect(switchModelVersion(admin(), older?.id ?? '', { reason: 'Again.' })).rejects.toThrow(ConflictError);
    await expect(switchModelVersion(admin(), 'f0f0f0f0-0000-4000-8000-000000000000', { reason: 'x' })).rejects.toThrow(NotFoundError);
    await expect(switchModelVersion(admin(), older?.id ?? '', {})).rejects.toThrow(InvalidInputError);
  });

  it('pauses the forecast and raises an alert for the recipients of the model_paused rule', async () => {
    expect((await modelNotifications()).filter((n) => n.title_en === 'Forecast paused')).toHaveLength(0);
    const state = await pauseModel(admin(), { reason: 'Data feed under repair.' });
    expect(state).toMatchObject({ is_paused: true, pause_reason: 'Data feed under repair.', paused_by_user_id: admin().userId });
    expect(state.paused_at).toEqual(expect.any(String));
    expectValid('ModelState', state);
    const alerts = (await modelNotifications()).filter((n) => n.title_en === 'Forecast paused');
    expect(alerts.map((n) => n.recipient_role).sort()).toEqual(['administrator', 'planner']);
    for (const alert of alerts) {
      expect(alert).toMatchObject({ category: 'model', severity: 'warning', is_read: false, data_source: 'SYNTHETIC', link_path: '/admin/forecast-model' });
      expect(alert.body_en).toContain('Data feed under repair.');
      expectValid('Notification', alert);
    }
    expect(await auditOf('model.paused')).toHaveLength(1);
    await expect(pauseModel(admin(), { reason: 'Again.' })).rejects.toThrow(ConflictError);
  });

  it('does not run the forecast while paused, and does after resuming', async () => {
    const before = (await listForecastRuns(admin())).items.length;
    await pauseModel(admin(), { reason: 'Hold.' });
    await expect(createForecastRun(admin(), { horizon_start_date: '2026-09-15', horizon_days: 3 })).rejects.toThrow(ConflictError);
    expect(await resumeModel(admin(), { reason: 'Feed repaired.' })).toMatchObject({ is_paused: false, paused_at: null, pause_reason: null });
    await expect(resumeModel(admin(), { reason: 'x' })).rejects.toThrow(ConflictError);
    const run = await createForecastRun(admin(), { horizon_start_date: '2026-09-15', horizon_days: 3 });
    expect(run).toMatchObject({ status: 'succeeded', illustrative: true, horizon_days: 3, model_version: 'ensemble-4', data_source: 'SYNTHETIC' });
    expectValid('ForecastRun', run);
    expect((await listForecastRuns(admin())).items).toHaveLength(before + 1);
    expect((await getModelState(admin())).last_forecast_run_id).toBe(run.id);
    expect(await auditOf('model.resumed')).toHaveLength(1);
    expect(await auditOf('forecast.run_created')).toHaveLength(1);
  });

  it('rejects a forecast run outside the contract', async () => {
    await expect(createForecastRun(admin(), { horizon_start_date: '2026-09-15', horizon_days: 31 })).rejects.toThrow(InvalidInputError);
    await expect(createForecastRun(admin(), { horizon_start_date: 'tomorrow', horizon_days: 2 })).rejects.toThrow(InvalidInputError);
    await expect(createForecastRun(admin(), { horizon_start_date: '2026-09-15', horizon_days: 2, tenant_id: 'x' })).rejects.toThrow(InvalidInputError);
  });
});

describe('retraining schedule and settings', () => {
  it('replaces the schedule and validates it', async () => {
    const state = await updateRetrainingSchedule(admin(), { cadence: 'daily', day_of_week: null, time_of_day: '03:30' });
    expect(state.retraining_schedule).toEqual({ cadence: 'daily', day_of_week: null, time_of_day: '03:30' });
    expectValid('ModelState', state);
    expect((await updateRetrainingSchedule(admin(), { cadence: 'weekly', day_of_week: 2, time_of_day: '01:00' })).retraining_schedule.day_of_week).toBe(2);
    await expect(updateRetrainingSchedule(admin(), { cadence: 'weekly', time_of_day: '01:00' })).rejects.toThrow(InvalidInputError);
    await expect(updateRetrainingSchedule(admin(), { cadence: 'hourly', time_of_day: '01:00' })).rejects.toThrow(InvalidInputError);
    await expect(updateRetrainingSchedule(admin(), { cadence: 'daily', time_of_day: '25:00' })).rejects.toThrow(InvalidInputError);
    expect(await auditOf('model.retraining_schedule_changed')).toHaveLength(2);
  });

  it('exposes the two settings operations of the module through settings.ts', async () => {
    expect((await updateClockStart(admin(), { clock_start: 'registration' })).clock_start).toBe('registration');
    expect((await updatePlanningLevel(admin(), { planning_level: 'sub_zone' })).planning_level).toBe('sub_zone');
  });

  it('chooses the challenger and the gate baseline, audited, administrators only', async () => {
    const before = await getForecastModelSettings(admin());
    expectValid('ForecastModelSettings', before);
    expect(before).toMatchObject({ champion_model: 'ensemble-4', gate_baseline: 'segment' });
    expect(before.models).toHaveLength(11);
    const chosen = await updateForecastModelSettings(admin(), { challenger_model: 'sarima-1', gate_baseline: 'naive' });
    expect(chosen).toMatchObject({ challenger_model: 'sarima-1', gate_baseline: 'naive' });
    const none = await updateForecastModelSettings(admin(), { challenger_model: null });
    expect(none).toMatchObject({ challenger_model: null, gate_baseline: 'naive' });
    expectValid('ForecastModelSettings', none);
    await expect(updateForecastModelSettings(admin(), { challenger_model: 'ensemble-4' })).rejects.toThrow(InvalidInputError);
    await expect(updateForecastModelSettings(admin(), { gate_baseline: 'best' })).rejects.toThrow(InvalidInputError);
    await expect(updateForecastModelSettings(ctxFor('planner'), { gate_baseline: 'segment' })).rejects.toThrow(ForbiddenError);
    expect(await auditOf('forecast.model_settings_changed')).toHaveLength(2);
    await updateForecastModelSettings(admin(), { gate_baseline: 'segment' });
  });
});

describe('who may write, and persistence', () => {
  it('keeps every other role out and audits the denial', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      const ctx = ctxFor(role);
      await expect(pauseModel(ctx, { reason: 'x' })).rejects.toThrow(ForbiddenError);
      await expect(resumeModel(ctx, { reason: 'x' })).rejects.toThrow(ForbiddenError);
      await expect(switchModelVersion(ctx, 'f0f0f0f0-0000-4000-8000-000000000000', { reason: 'x' })).rejects.toThrow(ForbiddenError);
      await expect(updateRetrainingSchedule(ctx, { cadence: 'manual', time_of_day: '02:00' })).rejects.toThrow(ForbiddenError);
      await expect(createForecastRun(ctx, { horizon_start_date: '2026-09-15', horizon_days: 1 })).rejects.toThrow(ForbiddenError);
    }
    expect((await getModelState(admin())).is_paused).toBe(false);
    expect((await auditOf('model.paused', 'denied')).length).toBeGreaterThanOrEqual(6);
  });

  it('keeps the pause across a fresh module instance and audits it', async () => {
    await pauseModel(admin(), { reason: 'Persist me.' });
    vi.resetModules();
    const fresh = await import('./models');
    expect(await fresh.getModelState(admin())).toMatchObject({ is_paused: true, pause_reason: 'Persist me.' });
    const freshAudit = await import('./audit');
    expect((await freshAudit.listAuditEvents(admin(), { action: 'model.paused' })).items[0]).toMatchObject({ entity_type: 'model', outcome: 'success', actor_user_id: admin().userId });
  });
});
