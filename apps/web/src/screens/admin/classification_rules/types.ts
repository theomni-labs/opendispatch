// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Classification Rules screen: what the server side hands to the client files.
// Everything here is JSON-safe, so it can cross from the Server Component to the tables and forms. Nothing here is a context, a
// customer or the caller's role, except `ApprovalGate`, which says what the server decided about approving.

import type { DataSource, RuleOutcome } from '@/lib/types';

export const OUTCOMES = ['field_mandatory', 'field_preferred', 'remote_eligible'] as const satisfies readonly RuleOutcome[];
export type Outcome = (typeof OUTCOMES)[number];

/** The category colour of an outcome's tag (colour means category, never decoration). */
export const OUTCOME_COLOR = { field_mandatory: 'red', field_preferred: 'gold', remote_eligible: 'green' } as const satisfies Record<Outcome, string>;

/** The status of one rule version, as the data layer keeps it. `superseded` is a version an approved one replaced. */
export type VersionStatus = 'draft' | 'submitted' | 'active' | 'rejected' | 'superseded' | 'retired';
/** What a rule row and a status filter show: the status of the version the row stands for (a rule is never `superseded`). */
export type RuleStatus = 'draft' | 'submitted' | 'active' | 'rejected' | 'retired';
export const RULE_STATUSES = ['draft', 'submitted', 'active', 'rejected', 'retired'] as const satisfies readonly RuleStatus[];

export const OPERATORS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'] as const;
export type Operator = (typeof OPERATORS)[number];

/** The value of one condition row, as the data layer's `RulePredicate` keeps it. A list goes with the `in` operator. */
export type PredicateValue = string | number | boolean | readonly (string | number)[];

export interface Predicate {
  readonly field: string;
  readonly operator: Operator;
  readonly value: PredicateValue;
}

export interface Condition {
  readonly match: 'all' | 'any';
  readonly predicates: readonly Predicate[];
}

export interface VersionRow {
  readonly version: number;
  readonly status: VersionStatus;
  readonly outcome: Outcome;
  readonly condition: Condition;
  readonly conditionText: string;
  /** `YYYY-MM-DD`, or null when it is not set (an approved version then takes effect on the day it is approved). */
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly note: string | null;
}

/** Why Approve and Reject are not available to the person, or null when they are. */
export type ApprovalDenial = 'role' | 'own' | null;

export interface RuleRow {
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly sourceNote: string | null;
  /** The rule's own status: draft (never approved), active, or retired. */
  readonly ruleStatus: 'draft' | 'active' | 'retired';
  /** The version the row stands for: the active one, else the newest. */
  readonly current: VersionRow;
  /** A newer version waiting (draft or submitted) beside the active one: "v2 draft". */
  readonly next: number | null;
  /** The version that is drafted or submitted, when there is one: the drawer opens on it. */
  readonly working: number | null;
}

export interface ApprovalRow {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly summary: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  /** ISO 8601. */
  readonly requestedAt: string;
  readonly decidedBy: string | null;
  readonly denial: ApprovalDenial;
}

export interface HistoryItem {
  readonly id: string;
  readonly kind: 'created' | 'submitted' | 'approved' | 'rejected' | 'effect' | 'retired';
  readonly version: number;
  /** ISO 8601 (or a `YYYY-MM-DD` day for `effect`). */
  readonly at: string;
  readonly name: string | null;
  readonly note: string | null;
}

/** The rule `?rule=` opens, with everything the drawer draws. */
export interface OpenRule {
  readonly rule: RuleRow;
  readonly versions: readonly VersionRow[];
  /** The version the drawer shows: `?version=`, else the working one, else the active one, else the newest. */
  readonly shown: number;
  readonly history: readonly HistoryItem[];
  /** Approve and Reject for the shown version, which the server decided from the role and the submitter. */
  readonly denial: ApprovalDenial;
}

export interface FieldChoice {
  readonly field: string;
  readonly kind: 'num' | 'bool' | 'enum';
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types:
// no field here is a context, customer, user, role, zone scope or install mode.
// ---------------------------------------------------------------------------------------------

/** The content of a rule version, as the form has it. */
export interface VersionInput {
  readonly match: 'all' | 'any';
  readonly predicates: readonly Predicate[];
  readonly condition_text_en: string;
  readonly outcome: string;
  /** `YYYY-MM-DD`, or empty for none. */
  readonly effective_from: string;
  readonly effective_to: string;
}

export interface CreateRuleInput extends VersionInput {
  readonly rule_code: string;
  readonly name_en: string;
  readonly name_ar: string;
  /** Also submit the new rule's first version for approval. */
  readonly submit: boolean;
}

export interface SaveDraftInput extends VersionInput {
  readonly rule_code: string;
  readonly version: number;
  /** Also submit the saved draft for approval. */
  readonly submit: boolean;
}

export interface RuleTarget {
  readonly rule_code: string;
  readonly version: number;
}

export interface DecideInput extends RuleTarget {
  /** Required to reject; optional to approve. */
  readonly note: string;
}

export interface RetireInput {
  readonly rule_code: string;
  readonly note: string;
}

export interface RuleSummary {
  readonly code: string;
  readonly version: number;
  /** `YYYY-MM-DD`: when an approved version takes effect. Only for an approval. */
  readonly effectiveFrom?: string | undefined;
  /** The rule was created by this call. */
  readonly created?: boolean | undefined;
  /** The version was also submitted for approval by this call. */
  readonly submitted?: boolean | undefined;
}

/** What the assistant's Draft button sends: the person's own words and the page language. */
export interface AssistantDraftInput {
  readonly text: string;
  readonly locale: string;
}

/** One row of the AI review: a suggestion against the rules. */
export interface AiReviewRow {
  readonly id: string;
  readonly caseNumber: string;
  readonly ai: { readonly handling: 'field' | 'remote_inferred'; readonly severity: 'minor' | 'moderate' | 'severe' };
  readonly rule: { readonly handling: 'field' | 'remote_inferred'; readonly ruleName: string | null };
  readonly agrees: boolean;
  readonly pct: number;
  readonly reason: string;
  readonly review: 'accepted' | 'rejected' | null;
}

/** The AI review tab (plain data). */
export interface AiReviewView {
  readonly compared: number;
  readonly handlingPct: number | null;
  readonly severityPct: number | null;
  readonly reviewed: number;
  readonly rows: readonly AiReviewRow[];
  readonly provider: string | null;
  readonly only: 'all' | 'disagreements';
  readonly sources: readonly DataSource[];
}

export interface RunClassifierInput {
  readonly locale: string;
}
