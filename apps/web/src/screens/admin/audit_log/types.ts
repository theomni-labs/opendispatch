// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Audit Log screen: what the server side hands to the client files. Everything
// here is JSON-safe. Nothing here is a context, a customer or the caller's role.

import type { Role } from '@/lib/access';

export type AuditOutcome = 'success' | 'failure' | 'denied';
export type ActorType = 'user' | 'system' | 'emergency_admin' | 'demo';

/** The mockup's category chips. Each stands for a list of action prefixes (view.ts). */
export const AUDIT_CATEGORIES = ['signin', 'rules', 'rosters', 'settings', 'imports', 'model', 'system'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_PERIODS = ['24h', '7d'] as const;
export type AuditPeriod = (typeof AUDIT_PERIODS)[number];

/** Where an event came from, as the Source column says it. */
export type AuditSource = 'signin' | 'admin' | 'ops' | 'system';

/** One event as the table and the drawer need it. */
export interface AuditRow {
  readonly id: string;
  /** ISO 8601 with offset. */
  readonly occurredAt: string;
  /** The display name of the actor, when there is one (from `listUserDisplayNames`, open to every role that reads the log). */
  readonly actorName: string | null;
  /** The actor's role, when the server gives it. */
  readonly actorRole: Role | null;
  readonly actorType: ActorType;
  readonly action: string;
  readonly entityType: string;
  /** The entity id as stored, or null. */
  readonly entityId: string | null;
  /** A short form of the entity id for the table: the id when it is a readable name, else its first characters. */
  readonly entityLabel: string | null;
  /** The data layer's English text. */
  readonly summary: string;
  /** Values for the translated summary, or null. */
  readonly summaryParams: Readonly<Record<string, string | number>> | null;
  readonly outcome: AuditOutcome;
  readonly source: AuditSource;
  readonly correlationId: string | null;
}

/** The open event: the row, and its record as the drawer's JSON block writes it. */
export interface AuditOpen {
  readonly row: AuditRow;
  readonly json: string;
}

/** What the browser sends to `exportAuditLog`: the filters a person typed or chose (no context, no role). */
export interface ExportFilter {
  readonly q?: string | undefined;
  readonly outcome?: string | undefined;
  readonly category?: string | undefined;
  readonly period?: string | undefined;
}
