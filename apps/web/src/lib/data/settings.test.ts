// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { listAuditEvents } from './audit';
import { ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import {
  getOverrideReasonCodes,
  getSkillVocabulary,
  listSettings,
  getSettingsSnapshot,
  primaryReading,
  setZoneStage,
  updateClockStart,
  updateLiveAssignmentSettings,
  updatePlanningLevel,
} from './settings';
import { fixtureRecords } from './internal/fixtures';
import type { Setting } from '@/lib/types';
import { ctxFor, expectValid, expectValidItems, fixtureZoneIds, withTempDemoState } from './test-support';

withTempDemoState();

describe('settings snapshot', () => {
  it('has the fixture defaults and validates against the contract', async () => {
    const ctx = ctxFor('administrator');
    const snapshot = await getSettingsSnapshot(ctx);
    expectValid('SettingsSnapshot', snapshot);
    expect(snapshot).toMatchObject({ clock_start: 'assignment', planning_level: 'zone', fallback_timeout_seconds: 5, install_mode: 'private' });
    expect(snapshot.live_assignment_stages).toHaveLength(8);
    expect(snapshot.live_assignment_stages.filter((s) => s.stage === 'recommend')).toHaveLength(2);
    expectValidItems('ZoneStage', snapshot.live_assignment_stages);
  });

  it('is readable by every role and reports the simulated install mode', async () => {
    for (const role of ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      expect((await getSettingsSnapshot(ctxFor(role))).install_mode).toBe('private');
    }
    expect((await getSettingsSnapshot(ctxFor('planner', { installMode: 'shared' }))).install_mode).toBe('shared');
    await expect(getSettingsSnapshot(ctxFor('change_approver', { installMode: 'dedicated' }))).rejects.toThrow(ForbiddenError);
  });

  it('shows a dispatcher only the stages of their own zones', async () => {
    const zones = fixtureZoneIds();
    const ctx = ctxFor('dispatcher', { zones: [zones[0] as string, zones[1] as string] });
    expect((await getSettingsSnapshot(ctx)).live_assignment_stages.map((s) => s.zone_id)).toEqual([zones[0], zones[1]]);
    expect((await getSettingsSnapshot(ctx)).live_assignment_stages).toHaveLength(2);
  });
});

describe('primary reading', () => {
  it('takes the primary from the setting and always keeps the other', () => {
    const both = { from_registration: 'R', from_assignment: 'A' };
    expect(primaryReading('assignment', both)).toMatchObject({ primary: 'A', secondary: 'R', primary_key: 'from_assignment' });
    expect(primaryReading('registration', both)).toMatchObject({ primary: 'R', secondary: 'A', primary_key: 'from_registration' });
  });
});

describe('writes', () => {
  it('changes the clock start point and the planning level (Admin 8) and audits both', async () => {
    const admin = ctxFor('administrator');
    expect((await updateClockStart(admin, { clock_start: 'registration' })).clock_start).toBe('registration');
    expect((await updatePlanningLevel(admin, { planning_level: 'city' })).planning_level).toBe('city');
    expect((await getSettingsSnapshot(ctxFor('planner'))).clock_start).toBe('registration');
    expect((await getSettingsSnapshot(ctxFor('planner'))).planning_level).toBe('city');
    const actions = (await listAuditEvents(admin, { limit: 5 })).items.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['settings.clock_start_changed', 'settings.planning_level_changed']));
  });

  it('refuses every other role, and audits the denial', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      await expect(updateClockStart(ctxFor(role), { clock_start: 'registration' })).rejects.toThrow(ForbiddenError);
      await expect(setZoneStage(ctxFor(role), fixtureZoneIds()[0] as string, { stage: 'automatic' })).rejects.toThrow(ForbiddenError);
    }
    const admin = ctxFor('administrator');
    expect((await getSettingsSnapshot(admin)).clock_start).toBe('assignment');
    expect((await listAuditEvents(admin, { outcome: 'denied', action: 'settings.clock_start_changed' })).items.length).toBeGreaterThanOrEqual(6);
  });

  it('validates the input', async () => {
    const admin = ctxFor('administrator');
    await expect(updateClockStart(admin, { clock_start: 'never' })).rejects.toThrow(InvalidInputError);
    await expect(updateClockStart(admin, { clock_start: 'assignment', extra: 1 })).rejects.toThrow(InvalidInputError);
    await expect(updateLiveAssignmentSettings(admin, { fallback_timeout_seconds: 0 })).rejects.toThrow(InvalidInputError);
    await expect(updateLiveAssignmentSettings(admin, {})).rejects.toThrow(InvalidInputError);
    await expect(setZoneStage(admin, fixtureZoneIds()[0] as string, { stage: 'fast' })).rejects.toThrow(InvalidInputError);
    await expect(setZoneStage(admin, '00000000-0000-4000-8000-000000000000', { stage: 'shadow' })).rejects.toThrow(NotFoundError);
  });

  it('sets the stage of a zone and the fallback settings (Admin 9), audited, visible to the Live Dispatch Board roles', async () => {
    const admin = ctxFor('administrator');
    const zone = fixtureZoneIds()[2] as string; // Riyadh East, shadow in the fixtures
    const stage = await setZoneStage(admin, zone, { stage: 'automatic', reason: 'Agreed with Customer.' });
    expectValid('ZoneStage', stage);
    expect(stage).toMatchObject({ zone_id: zone, stage: 'automatic', updated_by: admin.userId });
    expect((await getSettingsSnapshot(ctxFor('dispatcher', { zones: [zone] }))).live_assignment_stages[0]?.stage).toBe('automatic');
    const snapshot = await updateLiveAssignmentSettings(admin, { fallback_timeout_seconds: 8, decision_deadline_ms: 1500 });
    expect(snapshot).toMatchObject({ fallback_timeout_seconds: 8, decision_deadline_ms: 1500 });
    expect((await getSettingsSnapshot(ctxFor('dispatcher'))).fallback_timeout_seconds).toBe(8);
    const events = (await listAuditEvents(admin, { limit: 5 })).items;
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['settings.zone_stage_changed', 'settings.live_assignment_changed']));
    expect(events.find((e) => e.action === 'settings.zone_stage_changed')?.detail).toMatchObject({ from: 'shadow', to: 'automatic', reason: 'Agreed with Customer.' });
  });

  it('persists across a fresh module instance', async () => {
    await updateClockStart(ctxFor('administrator'), { clock_start: 'registration' });
    vi.resetModules();
    const fresh = await import('./settings');
    expect((await fresh.getSettingsSnapshot(ctxFor('planner'))).clock_start).toBe('registration');
  });
});

describe('vocabularies and the raw settings list', () => {
  it('serves the override reason codes and the skills vocabulary to every role', async () => {
    const codes = await getOverrideReasonCodes(ctxFor('dispatcher'));
    expect(codes.map((c) => c.code)).toEqual(['agent_unavailable', 'vehicle_unavailable', 'closer_agent_known', 'skills_needed', 'dispatcher_judgement', 'other']);
    expect(codes.filter((c) => c.requires_note).map((c) => c.code)).toEqual(['other']);
    const skills = await getSkillVocabulary(ctxFor('planner'));
    expect(skills.length).toBeGreaterThan(5);
    expect(skills.map((s) => s.code)).toContain('injury_protocol');
  });

  it('lists every stored setting for the Administrator only', async () => {
    const all = await listSettings(ctxFor('administrator'), { limit: 200 });
    expect(all.page.total).toBe(fixtureRecords<Setting>('Setting').length);
    expect(all.items.map((s) => s.key)).toEqual(expect.arrayContaining(['clock_start', 'planning_level', 'fallback_timeout_seconds']));
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      await expect(listSettings(ctxFor(role))).rejects.toThrow(ForbiddenError);
    }
  });
});
