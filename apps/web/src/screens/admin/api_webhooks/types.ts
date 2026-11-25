// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the API and Webhooks screen: what the server side hands to the client files.
// Everything here is JSON-safe. Nothing here is a context, a customer or the caller's role, and no API key is ever in it: a key
// exists only in the result of the create action, on its way to the dialog that must be acknowledged.

export const TABS = ['clients', 'hooks', 'log', 'limits'] as const;
export type Tab = (typeof TABS)[number];

export const SCOPES = ['read', 'write', 'feeds'] as const;
export type Scope = (typeof SCOPES)[number];

export const EVENT_TYPES = ['assignment.created', 'assignment.overridden', 'fallback.state_changed', 'forecast.completed', 'roster.approved', 'rule.approved', 'import.completed'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type DeliveryStatus = 'pending' | 'succeeded' | 'failed';

export interface ClientRow {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly Scope[];
  /** The last four characters of the key: all that is kept. */
  readonly hint: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revoked: boolean;
}

export interface HookRow {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly events: readonly EventType[];
  readonly enabled: boolean;
  readonly lastDeliveryAt: string | null;
  readonly lastStatus: 'succeeded' | 'failed' | null;
}

export interface DeliveryRow {
  readonly id: string;
  readonly hookId: string;
  readonly hookName: string;
  readonly event: EventType;
  readonly status: DeliveryStatus;
  readonly httpStatus: number | null;
  readonly attempts: number;
  /** ISO 8601 with offset. */
  readonly at: string;
}

export interface LimitRow {
  readonly scope: Scope;
  readonly requestsPerMinute: number;
  readonly burst: number;
  /** Active clients that have the scope. */
  readonly clients: number;
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types: no field
// here is a context, customer, user, role, zone scope or install mode.
// ---------------------------------------------------------------------------------------------

export interface ClientInput {
  readonly name: string;
  readonly scopes: readonly string[];
}

export interface ClientTarget {
  readonly clientId: string;
}

export interface HookInput {
  /** Set to change a webhook; absent to add one. */
  readonly hookId?: string | undefined;
  readonly name: string;
  readonly target_url: string;
  readonly event_types: readonly string[];
  readonly is_enabled: boolean;
}

export interface HookTarget {
  readonly hookId: string;
}

export interface DeliveryTarget {
  readonly deliveryId: string;
}

export interface LimitsInput {
  readonly limits: readonly { readonly scope: string; readonly requests_per_minute: number; readonly burst: number }[];
}

// What the actions give back.
/** The one place a key travels: the result of the create or rotate action, to the dialog that must be acknowledged. */
export interface ClientCreated {
  readonly id: string;
  readonly name: string;
  readonly secret: string;
}

export interface ClientRevoked {
  readonly id: string;
  readonly name: string;
}

export interface HookSaved {
  readonly id: string;
  readonly name: string;
}

export interface HookTested {
  readonly name: string;
  readonly delivered: boolean;
  readonly httpStatus: number | null;
}

export interface DeliveryRetried {
  readonly delivered: boolean;
  readonly httpStatus: number | null;
  readonly attempts: number;
}

export interface LimitsSaved {
  readonly limits: readonly { readonly scope: Scope; readonly requestsPerMinute: number; readonly burst: number }[];
}
