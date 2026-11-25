// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { confirmBackup, updateIntegration } from '@/lib/data/system';
import { BACKUP_OVERDUE_DAYS, ENGINES_STALE_MINUTES, isOverdue, loadEnginesView, loadHealthView } from './view';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// The server side of the screen against the real data layer and its seeds (8 services, 5 feeds, 11 job runs, the storage and backup
// status), with the demo store in a temp folder.
beforeEach(async () => {
  await resetGoTestState();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = (mode: InstallMode = 'private') => ctxOf('administrator', mode);
const NOW = Date.parse('2026-09-13T06:20:00+03:00');

describe('loadHealthView: the overview', () => {
  it('gives the overall health, the eight services and the counts of services up and failed jobs', async () => {
    const view = await loadHealthView(admin(), {}, NOW);
    expect(view.overall).toBe('degraded');
    expect(view.services.map((service) => service.name)).toEqual(['web', 'api', 'worker', 'engines', 'database', 'keycloak', 'object_storage', 'update_agent']);
    expect(view.services.find((service) => service.name === 'keycloak')?.status).toBe('unknown');
    expect(view.counts).toEqual({ servicesUp: 7, services: 8, failedJobs: 1 });
    expect(view.sources).toEqual(['SYNTHETIC']);
    expect(view.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('gives the five feeds with their kind, direction, health and last success; the degraded one carries its English error', async () => {
    const view = await loadHealthView(admin(), {}, NOW);
    expect(view.feeds.map((feed) => [feed.kind, feed.direction, feed.health])).toEqual([
      ['case_feed', 'inbound', 'healthy'],
      ['agent_feed', 'inbound', 'degraded'],
      ['assignment_channel', 'outbound', 'healthy'],
      ['weather_feed', 'inbound', 'disabled'],
      ['routing_feed', 'inbound', 'disabled'],
    ]);
    expect(view.feeds[0]?.lastSuccessAt).toBe('2026-09-13T05:59:20+03:00');
    expect(view.feeds[3]?.lastSuccessAt).toBeNull();
    expect(view.feeds[1]?.error).toMatch(/Position updates delayed/);
    expect(view.feeds[0]?.error).toBeNull();
  });

  it('follows a feed that goes down', async () => {
    const ctx = admin();
    const down = (await loadHealthView(ctx, {}, NOW)).feeds[0];
    await updateIntegration(ctx, down?.id as string, { is_enabled: false });
    const view = await loadHealthView(ctx, {}, NOW);
    expect(view.feeds[0]?.health).toBe('disabled');
  });

  it('reads the version from the Updates summary in every install mode, and the update agent\'s version only in a private one', async () => {
    const privateView = await loadHealthView(admin('private'), {}, NOW);
    expect(privateView.version).toEqual({ current: '1.1.0', channel: 'stable', agent: '0.4.0', installMode: 'private' });
    for (const mode of ['dedicated', 'shared'] as const) {
      const view = await loadHealthView(admin(mode), {}, NOW);
      expect(view.version).toMatchObject({ current: '1.1.0', agent: null, installMode: mode });
    }
  });

  it('does not ask for the update agent\'s status outside a private install (a refused read is audited as denied)', async () => {
    await loadHealthView(admin('shared'), {}, NOW);
    const denied = (await listAuditEvents(admin('private'), { outcome: 'denied', limit: 200 })).items.filter((event) => event.action.startsWith('update.'));
    expect(denied).toEqual([]);
  });

  it('says what the diagnostics file holds: the settings, the services, the feeds and the job runs', async () => {
    const view = await loadHealthView(admin(), {}, NOW);
    expect(view.diagnostics.settings).toEqual([
      { key: 'clock_start', value: 'assignment' },
      { key: 'planning_level', value: 'zone' },
      { key: 'fallback_timeout_seconds', value: '5' },
      { key: 'install_mode', value: 'private' },
      { key: 'time_zone', value: 'Asia/Riyadh' },
    ]);
    expect(view.diagnostics).toMatchObject({ services: 8, feeds: 5, jobs: 11 });
  });
});

describe('loadHealthView: job runs', () => {
  it('lists the eleven job runs newest first, with kind, status, start, duration and the message', async () => {
    const view = await loadHealthView(admin(), {}, NOW);
    expect(view.allJobs).toHaveLength(11);
    expect(view.jobs).toHaveLength(11);
    const starts = view.allJobs.map((job) => Date.parse(job.startedAt as string));
    expect([...starts].sort((a, b) => b - a)).toEqual(starts);
    expect(view.allJobs[0]).toMatchObject({ name: 'rollup-refresh', kind: 'rollup', status: 'succeeded', durationMs: 18_000 });
    expect(view.allJobs.at(-1)).toMatchObject({ name: 'import-validate', status: 'failed', message: 'The file header is missing required columns.', durationMs: 900 });
  });

  it('filters by status, by kind and by a search over the name and the message, and keeps the counts over all', async () => {
    const ctx = admin();
    expect((await loadHealthView(ctx, { status: 'failed' }, NOW)).jobs).toHaveLength(1);
    expect((await loadHealthView(ctx, { status: 'succeeded' }, NOW)).jobs).toHaveLength(10);
    expect((await loadHealthView(ctx, { kind: 'rollup' }, NOW)).jobs).toHaveLength(3);
    expect((await loadHealthView(ctx, { kind: 'retention' }, NOW)).jobs).toHaveLength(2);
    expect((await loadHealthView(ctx, { q: 'HEADER' }, NOW)).jobs.map((job) => job.status)).toEqual(['failed']);
    expect((await loadHealthView(ctx, { q: 'import', kind: 'import', status: 'failed' }, NOW)).jobs).toHaveLength(1);
    const none = await loadHealthView(ctx, { q: 'zzz' }, NOW);
    expect(none.jobs).toEqual([]);
    expect(none.allJobs).toHaveLength(11);
    expect(none.counts.failedJobs).toBe(1);
  });
});

describe('loadHealthView: storage and backups', () => {
  it('gives the storage in bytes by area (illustrative: nothing is measured in the demo)', async () => {
    const { storage } = await loadHealthView(admin(), {}, NOW);
    expect(storage.totalBytes).toBe(100 * 1024 ** 3);
    expect(storage.usedBytes).toBe(storage.areas.reduce((sum, area) => sum + area.usedBytes, 0));
    expect(storage.areas.map((area) => area.area).sort()).toEqual(['backups', 'exports', 'import_files', 'other']);
  });

  it('reads the backup status: who confirmed it (by name), the source, the restore drill; overdue after seven days', async () => {
    const view = await loadHealthView(admin(), {}, NOW);
    expect(view.backup).toMatchObject({ lastConfirmedAt: '2026-08-30T02:00:00+03:00', confirmedBy: 'Nadia Al-Ghalani', source: 'customer_reported', restoreDrillDue: '2026-09-30', overdue: true });
  });

  it('is no longer overdue once a backup is confirmed, and shows the confirmation as the new last confirmed', async () => {
    const ctx = admin();
    await confirmBackup(ctx, {});
    const view = await loadHealthView(ctx, {}, Date.now());
    expect(view.backup.overdue).toBe(false);
    expect(view.backup.confirmedBy).toBe('Nadia Al-Ghalani');
    expect(Date.now() - Date.parse(view.backup.lastConfirmedAt as string)).toBeLessThan(60_000);
  });

  it('counts a backup overdue after the interval, and when there is none', () => {
    expect(BACKUP_OVERDUE_DAYS).toBe(7);
    expect(isOverdue(null, NOW)).toBe(true);
    expect(isOverdue('2026-09-12T06:20:00+03:00', NOW)).toBe(false);
    expect(isOverdue('2026-09-06T06:20:00+03:00', NOW)).toBe(false);
    expect(isOverdue('2026-09-06T06:19:00+03:00', NOW)).toBe(true);
  });
});

describe('loadEnginesView', () => {
  it('gives the four engines in fixture mode, closed, with no model version or failure, and is fresh', async () => {
    const view = await loadEnginesView(admin());
    if (view.status !== 'ok') throw new Error('expected ok');
    expect(view.rows.map((row) => [row.engine, row.mode, row.breaker, row.modelVersion, row.lastFailureAt])).toEqual([
      ['forecaster', 'fixture', 'closed', null, null],
      ['optimizer', 'fixture', 'closed', null, null],
      ['simulator', 'fixture', 'closed', null, null],
      ['assignment', 'fixture', 'closed', null, null],
    ]);
    expect(view.stale).toBe(false);
  });

  it('is stale once the reading is older than the limit', async () => {
    const view = await loadEnginesView(admin(), Date.now() + (ENGINES_STALE_MINUTES + 1) * 60_000);
    expect(view.status === 'ok' && view.stale).toBe(true);
  });

  it('is an error, not a throw, for a role that may not read it', async () => {
    expect(await loadEnginesView(ctxOf('planner'))).toEqual({ status: 'error' });
  });
});

describe('roles', () => {
  it('reads for the Administrator in every install mode and refuses every other role', async () => {
    for (const mode of ['private', 'dedicated', 'shared'] as const) await expect(loadHealthView(admin(mode), {}, NOW), mode).resolves.toBeDefined();
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) await expect(loadHealthView(ctxOf(role), {}, NOW), role).rejects.toBeInstanceOf(ForbiddenError);
  });
});
