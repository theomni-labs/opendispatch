// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Security and Compliance screen: reads through lib/data with the request context and returns plain data
//. Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads: getSessionPolicy, listControlEvidence (`framework`), getSupportAccessSetting, listSupportAccessEvents, getSignInPolicy (the MFA
// claim: it is the Sign-in policy's, written from here through updateSignInPolicy) and `actorNames` (who granted a support access).

import { actorNames } from '@/components/opendispatch/patterns/audit-actors';
import type { RequestContext } from '@/lib/data/guard';
import { getSignInPolicy } from '@/lib/data/identity';
import { getSessionPolicy, getSupportAccessSetting, listControlEvidence, listSupportAccessEvents } from '@/lib/data/system';
import type { ControlEvidence, DataSource, PageInfo, SupportAccessEvent } from '@/lib/types';
import type { ControlRow, ControlStatus, Framework, SessionView, SupportGrant, SupportView } from './types';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface SecurityQuery {
  readonly q?: string | undefined;
  readonly framework?: Framework | undefined;
  readonly status?: ControlStatus | undefined;
  /** A control id: opens the evidence drawer. */
  readonly control?: string | undefined;
}

export interface SecurityView {
  readonly sources: readonly DataSource[];
  /** Every control, whatever the filters (the counts and the export use them all). */
  readonly all: readonly ControlRow[];
  /** The controls the search and filters leave. */
  readonly controls: readonly ControlRow[];
  readonly counts: { readonly total: number; readonly evidenced: number; readonly inProgress: number; readonly notStarted: number };
  readonly session: SessionView;
  readonly mfaRequired: boolean;
  readonly support: SupportView;
  /** The control `?control=` opens. */
  readonly openControl: ControlRow | undefined;
  /** `?control=` named a control that does not exist. */
  readonly unknownControl: boolean;
}

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

export const controlRow = (control: ControlEvidence): ControlRow => ({
  id: control.id,
  ref: control.control_ref,
  title: control.title_en,
  framework: control.framework,
  status: control.status,
  note: control.evidence_note ?? '',
  reviewedAt: control.reviewed_at ?? null,
});

/** Whole hours of a grant's window, at least one (the data layer grants whole hours). */
export function hoursOf(startedAt: string, endsAt: string | null): number {
  if (endsAt === null) return 0;
  return Math.max(1, Math.round((Date.parse(endsAt) - Date.parse(startedAt)) / 3_600_000));
}

function grantRow(event: SupportAccessEvent, names: Readonly<Record<string, string>>, nowMs: number): SupportGrant {
  return {
    id: event.id,
    startedAt: event.started_at,
    endsAt: event.ended_at ?? null,
    hours: hoursOf(event.started_at, event.ended_at ?? null),
    grantedBy: names[event.granted_by_user_id] ?? null,
    // A grant is open until its end: an entry with no end, or one that ends later than now.
    active: event.ended_at === null || Date.parse(event.ended_at) > nowMs,
  };
}

export async function loadSecurityView(ctx: RequestContext, query: SecurityQuery, nowMs: number = Date.now()): Promise<SecurityView> {
  const controlList = await listAll((cursor) => listControlEvidence(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const all = controlList.map(controlRow);
  const term = query.q?.toLowerCase();
  const controls = all.filter((control) => (query.framework === undefined || control.framework === query.framework) && (query.status === undefined || control.status === query.status) && (term === undefined || `${control.title} ${control.ref}`.toLowerCase().includes(term)));

  const session = await getSessionPolicy(ctx);
  const setting = await getSupportAccessSetting(ctx);
  const events = await listAll((cursor) => listSupportAccessEvents(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const names = await actorNames(ctx, events.map((event) => ({ actor_user_id: event.granted_by_user_id })));
  const grants = events.map((event) => grantRow(event, names, nowMs));
  const mfaRequired = (await getSignInPolicy(ctx)).require_mfa_claim;

  const openControl = query.control === undefined ? undefined : all.find((control) => control.id === query.control);

  return {
    sources: [...new Set([...controlList.map((control) => control.data_source), ...events.map((event) => event.data_source)])],
    all,
    controls,
    counts: {
      total: all.length,
      evidenced: all.filter((control) => control.status === 'evidenced').length,
      inProgress: all.filter((control) => control.status === 'in_progress').length,
      notStarted: all.filter((control) => control.status === 'not_started').length,
    },
    session: { lengthMinutes: session.session_length_minutes, idleMinutes: session.idle_timeout_minutes, perPerson: session.max_concurrent_sessions },
    mfaRequired,
    support: { enabled: setting.enabled, maxHours: setting.max_duration_hours, grants, openGrantId: grants.find((grant) => grant.active)?.id ?? null },
    openControl,
    unknownControl: query.control !== undefined && openControl === undefined,
  };
}
