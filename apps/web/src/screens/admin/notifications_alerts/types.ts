// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Notifications and Alerts screen: what the server side hands to the client files.
// JSON-safe (strings, numbers, booleans, arrays and objects of those). Nothing here is a context, a customer or the caller's
// role. Only in-app notifications exist (no e-mail is sent), and the quiet-hours window is stored, not applied.

import type { Tone } from '@opendispatch/ui';
import type { Role } from '@/lib/access';
import type { DataSource } from '@/lib/types';

export const TABS = ['rules', 'log'] as const;
export type Tab = (typeof TABS)[number];

export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** The tone of a severity: info, warning, and critical as danger. */
export const SEVERITY_TONE: Readonly<Record<Severity, Tone>> = { info: 'info', warning: 'warning', critical: 'danger' };

export const CHANNELS = ['in_app', 'email'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CATEGORIES = ['model', 'rule', 'roster', 'leave', 'import', 'integration', 'fallback', 'security', 'update', 'system', 'dispatch'] as const;
export type Category = (typeof CATEGORIES)[number];

export const READ_STATES = ['unread', 'read'] as const;
export type ReadState = (typeof READ_STATES)[number];

export const EVENT_TYPES = [
  'model_paused',
  'model_switched',
  'model_degraded',
  'rule_approved',
  'rule_rejected',
  'roster_approved',
  'override_created',
  'leave_decided',
  'import_failed',
  'integration_down',
  'fallback_active',
  'emergency_admin_sign_in',
  'update_ready',
  'update_failed',
  'backup_overdue',
  'case_unreachable',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * The category each event falls under (the sub-line of a rule, as the mockup does). The data layer keeps its own copy inside an
 * internal module that a screen may not import, so this is a copy; a rule record carries no category (a data-layer gap).
 */
export const EVENT_CATEGORY: Readonly<Record<EventType, Category>> = {
  model_paused: 'model',
  model_switched: 'model',
  model_degraded: 'model',
  rule_approved: 'rule',
  rule_rejected: 'rule',
  roster_approved: 'roster',
  override_created: 'roster',
  leave_decided: 'leave',
  import_failed: 'import',
  integration_down: 'integration',
  fallback_active: 'fallback',
  emergency_admin_sign_in: 'security',
  update_ready: 'update',
  update_failed: 'update',
  backup_overdue: 'system',
  case_unreachable: 'dispatch',
};

export const APPLIES_TO = ['email', 'email_and_in_app'] as const;
export type AppliesTo = (typeof APPLIES_TO)[number];

export interface RuleRow {
  readonly id: string;
  readonly event: EventType;
  readonly category: Category;
  readonly channels: readonly Channel[];
  readonly roles: readonly Role[];
  readonly severity: Severity;
  readonly enabled: boolean;
}

export interface AlertRow {
  readonly id: string;
  /** ISO 8601. */
  readonly at: string;
  /** The data layer's English line, and the Arabic one when the record has it. */
  readonly title: string;
  readonly titleAr: string | null;
  readonly body: string | null;
  readonly category: Category;
  readonly severity: Severity;
  readonly read: boolean;
  /** A role the alert is addressed to, or null when it is addressed to one person. */
  readonly toRole: Role | null;
  /** The person it is addressed to (their name), or null when it is addressed to a role. */
  readonly toName: string | null;
  /** True when the alert is addressed to the person looking (their own, or their role's): only those can be marked read. */
  readonly mine: boolean;
}

export interface QuietView {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
  readonly appliesTo: AppliesTo;
}

export interface NotificationsView {
  readonly rules: readonly RuleRow[];
  /** Every alert in the log, newest first; the screen filters them by what the address asks for. */
  readonly log: readonly AlertRow[];
  readonly quiet: QuietView;
  /** Rules that are switched on. */
  readonly rulesOn: number;
  /** Alerts nobody has read, over the whole log. */
  readonly unread: number;
  /** Alerts of critical severity, over the whole log. */
  readonly critical: number;
  /** The rule the address names, when it exists; `unknownRule` is true when it names none. */
  readonly openRule: RuleRow | undefined;
  readonly unknownRule: boolean;
  /** The name of the person looking, for the preview's example line; null when unknown. */
  readonly me: string | null;
  readonly sources: readonly DataSource[];
}

// ---------------------------------------------------------------------------------------------
// What the actions take and answer (the browser sends only these fields, never a context)
// ---------------------------------------------------------------------------------------------

export interface RuleInput {
  readonly ruleId: string;
  readonly channels: readonly Channel[];
  readonly roles: readonly Role[];
  readonly severity: Severity;
  readonly enabled: boolean;
}

export interface RuleToggle {
  readonly ruleId: string;
  readonly enabled: boolean;
}

export interface RuleSaved {
  readonly ruleId: string;
  readonly event: EventType;
  readonly enabled: boolean;
}

export interface TestInput {
  /** The rule the test is for. Left out: the first rule that is switched on. */
  readonly ruleId?: string | undefined;
}

export interface TestSent {
  readonly ruleId: string;
  readonly event: EventType;
  readonly notificationId: string;
}

export interface MarkRead {
  readonly ids: readonly string[];
}

export interface MarkedRead {
  /** Alerts that are now read. */
  readonly marked: number;
  /** Alerts left as they were: addressed to someone else, or no longer there. */
  readonly skipped: number;
}

export interface QuietInput {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
  readonly appliesTo: AppliesTo;
}
