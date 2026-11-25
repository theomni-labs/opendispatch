// SPDX-License-Identifier: AGPL-3.0-only
// Audit Log: thin client; Go records events.

import { requireFound, type PageQuery } from './context';
import { requireAccess, type RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import type { AuditEvent, AuditEventList, DataSource } from '@/lib/types';
import { requireId } from './internal/ids';

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export interface AuditFilter extends PageQuery {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly data_source?: DataSource | undefined;
  readonly action?: string | undefined;
  readonly entity_type?: string | undefined;
  readonly entity_id?: string | undefined;
  readonly actor_user_id?: string | undefined;
  readonly outcome?: AuditEvent['outcome'] | undefined;
  /**
   * Category filter (DG2): events whose action starts with this prefix, for example `rule.`. Several prefixes may be given,
   * separated by commas (at most 8): an event matches when its action starts with any of them. Empty means no filter.
   */
  readonly action_prefix?: string | undefined;
  /** Free-text search (DG2): case-insensitive, over the action, entity type, entity id, summary and the display name of the actor. */
  readonly q?: string | undefined;
}

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: listAuditEvents
export async function listAuditEvents(ctx: RequestContext, filter: AuditFilter = {}): Promise<AuditEventList> {
  requireAccess(ctx, 'admin.audit_log', 'view');
  // Go validates (business/audit.go).
  const query = qs({
    limit: filter.limit,
    cursor: filter.cursor,
    from: filter.from,
    to: filter.to,
    data_source: filter.data_source,
    action: filter.action,
    entity_type: filter.entity_type,
    entity_id: filter.entity_id,
    actor_user_id: filter.actor_user_id,
    outcome: filter.outcome,
    action_prefix: filter.action_prefix,
    q: filter.q,
  });
  return (await businessFetch<AuditEventList>(ctx, `/audit-events${query}`))!;
}

// operationId: getAuditEvent
export async function getAuditEvent(ctx: RequestContext, id: string): Promise<AuditEvent> {
  requireAccess(ctx, 'admin.audit_log', 'view');
  requireId(id, 'Audit event');
  return requireFound(await businessFetch<AuditEvent>(ctx, `/audit-events/${encodeURIComponent(id)}`), 'Audit event');
}
