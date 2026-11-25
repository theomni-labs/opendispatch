// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the System Health screen: reads through lib/data with the request context and returns plain data.
// Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads: getSystemHealth (services, feeds, overall), listIntegrations (a feed's direction and its last error), listJobRuns
// (`status`, `kind`), getStorageStatus, getBackupStatus, getUpdatesSummary (the version: every install mode) and, in a private install
// only, getUpdateStatus (the update agent's version: every other install mode is refused and audited, so it is not asked), and
// getSettingsSnapshot (what the diagnostics file holds).

import { actorNames } from '@/components/opendispatch/patterns/audit-actors';
import type { RequestContext } from '@/lib/data/guard';
import { listIntegrations } from '@/lib/data/system';
import { customerText } from '@/lib/data/wording';
import { getBackupStatus, getEngineStatuses, getStorageStatus, getSystemHealth, listJobRuns } from '@/lib/data/system';
import { getWorkingAssumptions } from '@/lib/data/models';
import { getSettingsSnapshot } from '@/lib/data/settings';
import { getUpdateStatus, getUpdatesSummary } from '@/lib/data/updates';
import type { DataSource, JobRun, PageInfo, WorkingAssumptions } from '@/lib/types';
import type { BackupView, DiagnosticsPreview, EnginesView, FeedRow, JobKind, JobRow, Overall, ServiceRow, StorageView, VersionView } from './types';
import { weatherHealth, weatherSourceOf } from './weather';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface HealthQuery {
  readonly q?: string | undefined;
  readonly status?: 'succeeded' | 'failed' | undefined;
  readonly kind?: JobKind | undefined;
}

export interface HealthView {
  readonly sources: readonly DataSource[];
  /** ISO 8601: when the checks were read. */
  readonly asOf: string;
  readonly overall: Overall;
  readonly services: readonly ServiceRow[];
  readonly feeds: readonly FeedRow[];
  /** Every job run, newest first. */
  readonly allJobs: readonly JobRow[];
  /** The job runs the search and filters leave. */
  readonly jobs: readonly JobRow[];
  readonly counts: { readonly servicesUp: number; readonly services: number; readonly failedJobs: number };
  readonly storage: StorageView;
  readonly backup: BackupView;
  readonly version: VersionView;
  readonly diagnostics: DiagnosticsPreview;
}

/** A backup confirmed longer ago than this is overdue (an assumption: no interval is specified; the customer's own backups are theirs). */
export const BACKUP_OVERDUE_DAYS = 7;
/** Older than this shows as stale. */
export const ENGINES_STALE_MINUTES = 5;

/** The Engines card's read; a failure is a card state. */
export async function loadEnginesView(ctx: RequestContext, nowMs: number = Date.now()): Promise<EnginesView> {
  let list;
  try {
    list = await getEngineStatuses(ctx);
  } catch {
    return { status: 'error' };
  }
  return {
    status: 'ok',
    asOf: list.as_of,
    stale: nowMs - Date.parse(list.as_of) > ENGINES_STALE_MINUTES * 60_000,
    rows: list.items.map((item) => ({
      engine: item.engine,
      mode: item.mode,
      breaker: item.breaker_state,
      calls: item.calls,
      failures: item.failures,
      timeouts: item.timeouts,
      rejected: item.rejected,
      breakerOpens: item.breaker_opens,
      fixtureAnswers: item.fallbacks,
      modelVersion: item.model_version,
      lastFailureAt: item.last_failure_at,
    })),
  };
}

export type EnginesTileDetail = { readonly kind: 'fixture' } | { readonly kind: 'on'; readonly on: number; readonly total: number } | null;

/** The Engines tile: the api's status (worst breaker); no engine data is Unknown; detail by mode. */
export function enginesTile(view: EnginesView | undefined, apiStatus: ServiceRow['status']): { status: ServiceRow['status']; detail: EnginesTileDetail } {
  if (view === undefined || view.status === 'error' || view.rows.length === 0) return { status: 'unknown', detail: null };
  const on = view.rows.filter((row) => row.mode === 'engine').length;
  return { status: apiStatus, detail: on === 0 ? { kind: 'fixture' } : { kind: 'on', on, total: view.rows.length } };
}

/** The diagnostics file holds the latest job runs, at most this many (system.ts diagnosticsFiles). */
const DIAGNOSTICS_JOBS = 50;
const PAGE = 200;

async function listAll<T>(fetch: (cursor: string | undefined) => { items: T[]; page: PageInfo } | Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

export const jobRow = (job: JobRun): JobRow => ({
  id: job.id,
  name: job.job_name,
  kind: job.kind,
  status: job.status,
  startedAt: job.started_at,
  durationMs: job.duration_ms ?? null,
  message: job.message ?? null,
});

/** True when the last confirmed backup is older than BACKUP_OVERDUE_DAYS, or there is none. */
export function isOverdue(lastConfirmedAt: string | null, nowMs: number): boolean {
  return lastConfirmedAt === null || nowMs - Date.parse(lastConfirmedAt) > BACKUP_OVERDUE_DAYS * 86_400_000;
}

async function readWeather(ctx: RequestContext): Promise<WorkingAssumptions['weather'] | null> {
  try {
    return (await getWorkingAssumptions(ctx)).weather;
  } catch {
    return null;
  }
}

export async function loadHealthView(ctx: RequestContext, query: HealthQuery, nowMs: number = Date.now()): Promise<HealthView> {
  const health = await getSystemHealth(ctx);
  const integrations = await listAll((cursor) => listIntegrations(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const byId = new Map(integrations.map((integration) => [integration.id, integration] as const));
  const services: ServiceRow[] = health.components.map((component) => ({ name: component.name, status: component.status }));
  const weatherNow = health.feeds.some((feed) => byId.get(feed.integration_id)?.kind === 'weather_feed') ? await readWeather(ctx) : null;
  const feeds: FeedRow[] = health.feeds.map((feed) => {
    const integration = byId.get(feed.integration_id);
    const weather = integration?.kind === 'weather_feed' ? weatherSourceOf(weatherNow) : null;
    const stored = weather?.kind === 'stored' ? (weatherNow?.fetched_at ?? null) : null;
    return {
      id: feed.integration_id,
      kind: integration?.kind ?? 'other',
      name: customerText(feed.name_en),
      direction: integration?.direction ?? 'inbound',
      health: weatherHealth(feed.health, weather),
      lastSuccessAt: feed.last_success_at ?? stored,
      error: feed.health === 'degraded' || feed.health === 'down' ? (integration?.last_error_message ?? null) : null,
      weather,
    };
  });

  const jobList = await listAll((cursor) => listJobRuns(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const allJobs = jobList.map(jobRow);
  const term = query.q?.toLowerCase();
  const jobs = allJobs.filter((job) => (query.status === undefined || job.status === query.status) && (query.kind === undefined || job.kind === query.kind) && (term === undefined || `${job.name} ${job.message ?? ''}`.toLowerCase().includes(term)));

  const storage = await getStorageStatus(ctx);
  const backup = await getBackupStatus(ctx);
  const names = await actorNames(ctx, [{ actor_user_id: backup.confirmed_by_user_id ?? null }]);

  const summary = await getUpdatesSummary(ctx);
  const agent = ctx.installMode === 'private' ? (await getUpdateStatus(ctx)).agent_version ?? null : null;
  const settings = await getSettingsSnapshot(ctx);

  return {
    sources: [...new Set([health.data_source, ...jobList.map((job) => job.data_source)])],
    asOf: health.as_of,
    overall: health.overall,
    services,
    feeds,
    allJobs,
    jobs,
    counts: { servicesUp: services.filter((service) => service.status === 'ok').length, services: services.length, failedJobs: allJobs.filter((job) => job.status === 'failed').length },
    storage: { usedBytes: storage.used_bytes, totalBytes: storage.total_bytes, areas: storage.areas.map((area) => ({ area: area.area, usedBytes: area.used_bytes })) },
    backup: {
      lastConfirmedAt: backup.last_confirmed_at,
      confirmedBy: backup.confirmed_by_user_id === null || backup.confirmed_by_user_id === undefined ? null : (names[backup.confirmed_by_user_id] ?? null),
      source: backup.source,
      restoreDrillDue: backup.restore_drill_due_at,
      overdue: isOverdue(backup.last_confirmed_at, nowMs),
    },
    version: { current: summary.current_version, channel: summary.channel ?? null, agent, installMode: ctx.installMode },
    diagnostics: {
      settings: [
        { key: 'clock_start', value: settings.clock_start },
        { key: 'planning_level', value: settings.planning_level },
        { key: 'fallback_timeout_seconds', value: String(settings.fallback_timeout_seconds) },
        { key: 'install_mode', value: settings.install_mode },
        { key: 'time_zone', value: settings.localization.time_zone },
      ],
      services: services.length,
      feeds: feeds.length,
      jobs: Math.min(allJobs.length, DIAGNOSTICS_JOBS),
    },
  };
}

