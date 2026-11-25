// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { MODULES } from '@/lib/access';
import { findModuleBySlug, moduleHref, moduleSlug, moduleSlugsOf } from './module-routes';

describe('module routes', () => {
  it('turns a module id into a hyphenated slug without the console prefix', () => {
    expect(moduleSlug('ops.live_dispatch_board')).toBe('live-dispatch-board');
    expect(moduleSlug('admin.users_roles')).toBe('users-roles');
    expect(moduleSlug('admin.updates')).toBe('updates');
  });

  it('builds hrefs without a locale prefix', () => {
    const def = MODULES.find((m) => m.id === 'ops.remote_queue');
    expect(def).toBeDefined();
    expect(moduleHref(def!)).toBe('/ops/remote-queue');
  });

  it('has 12 Ops and 18 Admin slugs, all unique inside a console', () => {
    const ops = moduleSlugsOf('ops').map((p) => p.module);
    const admin = moduleSlugsOf('admin').map((p) => p.module);
    expect(ops).toHaveLength(12);
    expect(admin).toHaveLength(18);
    expect(new Set(ops).size).toBe(12);
    expect(new Set(admin).size).toBe(18);
  });

  it('finds a module only in its own console', () => {
    expect(findModuleBySlug('ops', 'forecast-explorer')?.id).toBe('ops.forecast_explorer');
    expect(findModuleBySlug('admin', 'forecast-explorer')).toBeUndefined();
    expect(findModuleBySlug('ops', 'nope')).toBeUndefined();
    expect(findModuleBySlug('ops', '')).toBeUndefined();
  });

  it('round-trips every module', () => {
    for (const m of MODULES) expect(findModuleBySlug(m.console, moduleSlug(m.id))?.id).toBe(m.id);
  });
});
