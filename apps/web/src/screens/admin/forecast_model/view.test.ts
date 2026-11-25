// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { pauseModel } from '@/lib/data/models';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { engineModelOf, nextRetraining, loadModelView } from './view';

// The view against the real data layer and the committed fixtures, with the demo store in a temp folder.
function ctxOf(role: Role = 'administrator', installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

beforeEach(async () => {
  await resetGoTestState();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the model an engine made', () => {
  it('is the model of a succeeded run that is not the placeholder', () => {
    expect(engineModelOf({ status: 'succeeded', model_version: 'seasonal-profile-1' })).toBe('seasonal-profile-1');
    expect(engineModelOf({ status: 'succeeded', model_version: 'placeholder-0.1' })).toBeNull();
    expect(engineModelOf({ status: 'failed', model_version: 'seasonal-profile-1' })).toBeNull();
    expect(engineModelOf(undefined)).toBeNull();
  });
});

describe('the next retraining', () => {
  const at = (cadence: 'manual' | 'daily' | 'weekly' | 'monthly', time: string, day: number | null = null) => ({ cadence, day, time });
  // 2026-09-13 is a Sunday.
  it('a manual cadence has none', () => {
    expect(nextRetraining(at('manual', '02:00'), '2026-09-13', '06:00')).toBeNull();
  });

  it('daily is the next time of day that has not passed', () => {
    expect(nextRetraining(at('daily', '02:00'), '2026-09-13', '06:00')).toEqual({ date: '2026-09-14', time: '02:00' });
    expect(nextRetraining(at('daily', '22:00'), '2026-09-13', '06:00')).toEqual({ date: '2026-09-13', time: '22:00' });
  });

  it('weekly is the next chosen weekday at that time (a week on when it is today and has passed)', () => {
    expect(nextRetraining(at('weekly', '02:00', 5), '2026-09-13', '06:00')).toEqual({ date: '2026-09-18', time: '02:00' });
    expect(nextRetraining(at('weekly', '02:00', 0), '2026-09-13', '06:00')).toEqual({ date: '2026-09-20', time: '02:00' });
    expect(nextRetraining(at('weekly', '22:00', 0), '2026-09-13', '06:00')).toEqual({ date: '2026-09-13', time: '22:00' });
    expect(nextRetraining(at('weekly', '02:00', 6), '2026-12-30', '06:00')).toEqual({ date: '2027-01-02', time: '02:00' });
  });

  it('monthly is thirty days on', () => {
    expect(nextRetraining(at('monthly', '02:00'), '2026-09-13', '06:00')).toEqual({ date: '2026-10-13', time: '02:00' });
  });
});

describe('the view', () => {
  it('has the real engine versions with the active one named, the latest run, the seeded schedule, the two readings and Recent changes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T06:12:00+03:00'));
    const view = await loadModelView(ctxOf());
    expect(view.versions.map((v) => [v.version, v.status])).toEqual([['ensemble-4', 'active'], ['lightgbm-1', 'challenger'], ['ensemble-3', 'retired']]);
    expect(view.activeVersion).toBe('ensemble-4');
    expect(view.versions.some((v) => v.placeholder)).toBe(false);
    expect(view.run).toMatchObject({ status: 'succeeded', model: 'placeholder-0.1' });
    expect(view.pause).toEqual({ paused: false, pausedAt: null, pausedBy: null, reason: null });
    expect(view.schedule).toEqual({ cadence: 'weekly', day: 5, time: '02:00' });
    expect(view.nextRetraining).toEqual({ date: '2026-09-18', time: '02:00' });
    expect(view.clockStart).toBe('assignment');
    expect(view.planningLevel).toBe('zone');
    expect(view.reading).toMatchObject({ illustrative: true });
    expect(view.reading?.fromAssignment).toBeGreaterThan(0);
    expect(view.reading?.fromRegistration).toBeGreaterThan(0);
    expect(view.history?.events.length).toBeGreaterThan(0);
    expect(view.sources).toContain('SYNTHETIC');
  });

  it('names the person who paused the forecast and keeps their reason', async () => {
    await pauseModel(ctxOf(), { reason: 'The case feed is being fixed' });
    const view = await loadModelView(ctxOf());
    expect(view.pause).toMatchObject({ paused: true, reason: 'The case feed is being fixed' });
    expect(view.pause.pausedBy).toBe('Nadia Al-Ghalani');
    expect(view.history?.events[0]).toMatchObject({ action: 'model.paused' });
  });
});
