// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Audit Log screen: reads through lib/data with the request context and returns plain data.
// Not a Server Component and not an action: `Screen.tsx` and `actions.ts` call it, and the tests call it directly.
//
// Reads: listAuditEvents (the filters of DG2: `action_prefix` for the category chips, `q` for the search, `from` for the period,
// `outcome`), getAuditEvent (the open event), and `actorNames` (names for the Actor column through listUserDisplayNames, so the
// Viewer / Auditor and the Change Approver, who cannot read the users list, still see who did it). There is no write: the log is
// append only.

import { actorPeople, type ActorPerson } from '@/components/opendispatch/patterns/audit-actors';
import { shownActorType } from '@/components/opendispatch/patterns/system-actor';
import { getAuditEvent, listAuditEvents, type AuditFilter } from '@/lib/data/audit';
import { NotFoundError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import type { AuditEvent, DataSource } from '@/lib/types';
import type { ActorType, AuditCategory, AuditOpen, AuditOutcome, AuditPeriod, AuditRow, AuditSource } from './types';

/** Rows per page, as the mockup pages them. */
export const PAGE_SIZE = 10;
/** The data layer's page limit: the screen walks pages of this size. */
const CHUNK = 200;
/** An export holds at most this many events (the newest); the file says how many it wrote. */
export const EXPORT_LIMIT = 5000;

/**
 * The action prefixes each category chip stands for (the mockup's chips: Sign-in, Rules, Rosters, Settings, Imports, Model,
 * System). `listAuditEvents` takes at most 8 prefixes per filter (audit.ts MAX_PREFIXES), so a category is one list of at
 * most 8; an action family that is in none of them (users, locations, webhooks,...) is found under "All" or by search. `setting`
 * has no dot on purpose: the seeded events say `setting.update` and the writes `settings.zone_stage_changed`.
 */
export const CATEGORY_PREFIXES: Readonly<Record<AuditCategory, readonly string[]>> = {
  signin: ['sign_in.', 'auth.'],
  rules: ['rule.'],
  rosters: ['roster.', 'override.', 'break.', 'standby.'],
  settings: ['setting', 'sign_in_policy.', 'session_policy.', 'identity', 'role_mapping.', 'localization.', 'quiet_hours.', 'notification_rule.'],
  imports: ['import.', 'location.imported', 'agent.imported'],
  model: ['model.', 'forecast.', 'simulation.', 'scenario.'],
  system: ['demo.', 'assignment.', 'integration.', 'fallback.', 'update.', 'backup.', 'diagnostics.', 'support_access.'],
};

const PERIOD_MS: Readonly<Record<AuditPeriod, number>> = { '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 };

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface AuditQuery {
  readonly q?: string | undefined;
  readonly outcome?: 'success' | 'denied' | undefined;
  readonly cat?: AuditCategory | undefined;
  readonly period?: AuditPeriod | undefined;
  readonly page?: number | undefined;
  readonly id?: string | undefined;
}

export interface AuditView {
  readonly sources: readonly DataSource[];
  /** Every event in the log, whatever the filters. */
  readonly total: number;
  readonly counts: { readonly all: number; readonly last24h: number; readonly signIns: number; readonly denied: number };
  /** The events matching the filters. */
  readonly matching: number;
  readonly page: number;
  readonly pageCount: number;
  readonly rows: readonly AuditRow[];
  readonly open: AuditOpen | undefined;
  /** `?id=` named an event that does not exist. */
  readonly unknownId: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The entity id as a table shows it: a readable id as it is, a UUID as its first characters. */
export function entityLabel(entityId: string | null | undefined): string | null {
  if (entityId === null || entityId === undefined || entityId === '') return null;
  return UUID.test(entityId) ? entityId.slice(0, 8) : entityId.length > 40 ? `${entityId.slice(0, 39)}…` : entityId;
}

/** The Source column: sign-in events, Ops writes, jobs and demo tooling, and the rest is the Admin Console. */
export function sourceOf(action: string, actorType: ActorType): AuditSource {
  if (/^(sign_in|auth)\./.test(action)) return 'signin';
  if (actorType === 'system' || actorType === 'demo') return 'system';
  if (/^(roster|override|break|standby|leave|remote_queue|scenario|simulation|assignment)\./.test(action)) return 'ops';
  return 'admin';
}

export function rowOf(event: AuditEvent, people: Readonly<Record<string, ActorPerson>>): AuditRow {
  const actor = event.actor_user_id ?? null;
  const actorType = shownActorType(event);
  const person = actor === null ? undefined : people[actor];
  return {
    id: event.id,
    occurredAt: event.occurred_at,
    actorName: person?.name ?? null,
    actorRole: person?.role ?? null,
    actorType,
    action: event.action,
    entityType: event.entity_type,
    entityId: event.entity_id ?? null,
    entityLabel: entityLabel(event.entity_id),
    summary: event.summary_en,
    summaryParams: event.summary_params ?? null,
    outcome: event.outcome as AuditOutcome,
    source: sourceOf(event.action, actorType),
    correlationId: event.correlation_id ?? null,
  };
}

/** The record as the drawer's Detail block shows it, in the mockup's key order. */
export function eventJson(event: AuditEvent): string {
  return JSON.stringify(
    {
      id: event.id,
      tenant_id: event.tenant_id,
      occurred_at: event.occurred_at,
      actor_type: event.actor_type,
      actor_user_id: event.actor_user_id ?? null,
      action: event.action,
      entity_type: event.entity_type,
      entity_id: event.entity_id ?? null,
      outcome: event.outcome,
      summary_en: event.summary_en,
      correlation_id: event.correlation_id ?? null,
      detail: event.detail ?? {},
      data_source: event.data_source,
    },
    null,
    2,
  );
}

/** The data function's filter for what the address asks; `nowMs` is the server clock, for the period. */
export function filterOf(query: Pick<AuditQuery, 'q' | 'outcome' | 'cat' | 'period'>, nowMs: number): AuditFilter {
  return {
    ...(query.q === undefined ? {} : { q: query.q }),
    ...(query.outcome === undefined ? {} : { outcome: query.outcome }),
    ...(query.cat === undefined ? {} : { action_prefix: CATEGORY_PREFIXES[query.cat].join(',') }),
    ...(query.period === undefined ? {} : { from: new Date(nowMs - PERIOD_MS[query.period]).toISOString() }),
  };
}

/** `count` events of the filter starting at `offset`, newest first, and how many match. Walks the data layer's pages. */
export async function readEvents(ctx: RequestContext, filter: AuditFilter, offset: number, count: number): Promise<{ events: AuditEvent[]; total: number }> {
  const events: AuditEvent[] = [];
  let cursor: string | undefined;
  let total: number | undefined;
  for (;;) {
    const page = await listAuditEvents(ctx, { ...filter, limit: CHUNK, ...(cursor === undefined ? {} : { cursor }) });
    events.push(...page.items);
    total = page.page.total ?? total;
    if (events.length >= offset + count || !page.page.has_more || page.page.next_cursor === null) break;
    cursor = page.page.next_cursor;
  }
  return { events: events.slice(offset, offset + count), total: total ?? events.length };
}

async function countOf(ctx: RequestContext, filter: AuditFilter): Promise<number> {
  return (await readEvents(ctx, filter, 0, 1)).total;
}

export async function loadAuditView(ctx: RequestContext, query: AuditQuery, rawId?: string | undefined, nowMs: number = Date.now()): Promise<AuditView> {
  const filter = filterOf(query, nowMs);
  const [all, last24h, signIns, denied] = await Promise.all([
    countOf(ctx, {}),
    countOf(ctx, filterOf({ period: '24h' }, nowMs)),
    countOf(ctx, filterOf({ cat: 'signin' }, nowMs)),
    countOf(ctx, { outcome: 'denied' }),
  ]);

  const first = await readEvents(ctx, filter, 0, 1);
  const matching = first.total;
  const pageCount = Math.max(1, Math.ceil(matching / PAGE_SIZE));
  const page = Math.min(Math.max(query.page ?? 1, 1), pageCount);
  const shown = await readEvents(ctx, filter, (page - 1) * PAGE_SIZE, PAGE_SIZE);

  let opened: AuditEvent | undefined;
  if (query.id !== undefined) {
    try {
      opened = await getAuditEvent(ctx, query.id);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }

  const names = await actorPeople(ctx, opened === undefined ? shown.events : [...shown.events, opened]);
  const rows = shown.events.map((event) => rowOf(event, names));
  const asked = rawId !== undefined && rawId !== '';
  const sources = [...new Set([...shown.events, ...(opened === undefined ? [] : [opened])].map((event) => event.data_source))];

  return {
    sources: sources.length === 0 ? ['SYNTHETIC'] : sources,
    total: all,
    counts: { all, last24h, signIns, denied },
    matching,
    page,
    pageCount,
    rows,
    open: opened === undefined ? undefined : { row: rowOf(opened, names), json: eventJson(opened) },
    unknownId: asked && opened === undefined,
  };
}
