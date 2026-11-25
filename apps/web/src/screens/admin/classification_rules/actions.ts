'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Classification Rules screen: exactly the data functions of lib/data/rules.ts.
//
//   draftRule           createRule (+ submitRuleVersion when the person presses Submit for approval)
//   saveRuleDraft       updateRuleVersionDraft (+ submitRuleVersion)
//   draftNewVersion     createRuleVersionDraft   (from the active version, or from a rejected one: "Revise as draft")
//   approveRule, rejectRule   approveRuleVersion, rejectRuleVersion   (the Dispatch Supervisor; never the submitter)
//   retireRuleNow       retireRule
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. Who approves is
// the data layer's decision (`checkApproval`): the screen only says it first. A rejection needs a written note (the contract says
// so; the data layer takes it as optional), which this file checks for the roles that may reject.
// (tools/rules/context-rules.test.ts scans this file for the forbidden names.)

import { approvalKindsFor } from '@/lib/access';
import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { ForbiddenError, InvalidInputError } from '@/lib/data/errors';
import { draftRuleWithAssistant, type AssistantRuleDraft } from '@/lib/data/assistant';
import { runClassifierReview } from '@/lib/data/case-suggestions';
import type { ClassifierRun } from '@/lib/types';
import { approveRuleVersion, createRule, createRuleVersionDraft, listRuleVersions, rejectRuleVersion, retireRule, submitRuleVersion, updateRuleVersionDraft } from '@/lib/data/rules';
import type { AssistantDraftInput, RunClassifierInput, CreateRuleInput, DecideInput, RetireInput, RuleSummary, RuleTarget, SaveDraftInput } from './types';

const REVALIDATE = '/admin/classification-rules';

type Fields = Readonly<Record<string, unknown>>;

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const nullIfEmpty = (value: string): string | null => (value === '' ? null : value);

/** The body of a rule version from what the form sent: only the keys the data layer knows, so nothing else is forwarded. */
function versionBody(input: Fields): Record<string, unknown> {
  const predicates = Array.isArray(input['predicates']) ? (input['predicates'] as unknown[]).map((p) => pickFields(p, ['field', 'operator', 'value'])) : input['predicates'];
  return {
    condition: { match: input['match'], predicates },
    condition_text_en: textOf(input['condition_text_en']),
    outcome: input['outcome'],
    effective_from: nullIfEmpty(textOf(input['effective_from'])),
    effective_to: nullIfEmpty(textOf(input['effective_to'])),
  };
}

const VERSION_KEYS = ['match', 'predicates', 'condition_text_en', 'outcome', 'effective_from', 'effective_to'] as const;

/** The read; a Go refusal denies the write. */
async function readOrDeny<T>(read: () => Promise<T>, deny: () => Promise<unknown>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError) await deny();
    throw error;
  }
}

const ruleCodeOf = (input: unknown): string => pickText(input, 'rule_code') ?? '';
const versionOf = (input: unknown): number => {
  const version = pickFields(input, ['version']).version;
  return typeof version === 'number' ? version : Number.NaN;
};

/** Drafts a new rule (version 1, Draft), and submits it for approval when asked. Two audited writes: the draft stays if the second is refused. */
export async function draftRule(input: CreateRuleInput): Promise<ActionResult<RuleSummary>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['rule_code', 'name_en', 'name_ar', 'submit', ...VERSION_KEYS]);
      const code = textOf(fields['rule_code']);
      await createRule(ctx, { rule_code: code, name_en: textOf(fields['name_en']), name_ar: nullIfEmpty(textOf(fields['name_ar'])), first_version: versionBody(fields) });
      const submit = fields['submit'] === true;
      if (submit) await submitRuleVersion(ctx, code, 1);
      return { code, version: 1, created: true, submitted: submit } satisfies RuleSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Saves the changes to a draft version, and submits it for approval when asked. */
export async function saveRuleDraft(input: SaveDraftInput): Promise<ActionResult<RuleSummary>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['rule_code', 'version', 'submit', ...VERSION_KEYS]);
      const code = textOf(fields['rule_code']);
      const version = versionOf(fields);
      await updateRuleVersionDraft(ctx, code, version, versionBody(fields));
      const submit = fields['submit'] === true;
      if (submit) await submitRuleVersion(ctx, code, version);
      return { code, version, submitted: submit } satisfies RuleSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/**
 * Drafts the next version of a rule from a version it has: the active one ("Draft new version") or a rejected one ("Revise as
 * draft"). The new draft carries the conditions and the outcome; it has no effective date, so it takes effect the day it is approved.
 */
export async function draftNewVersion(input: RuleTarget): Promise<ActionResult<RuleSummary>> {
  return runAction(
    async (ctx) => {
      const code = ruleCodeOf(input);
      const version = versionOf(input);
      const versions = await readOrDeny(() => listRuleVersions(ctx, code, { limit: 200 }), () => createRuleVersionDraft(ctx, code, {}));
      const from = versions.items.find((v) => v.version === version);
      if (from === undefined) throw new InvalidInputError(`Version ${String(version)} of ${code} does not exist.`);
      const created = await createRuleVersionDraft(ctx, code, { condition: from.condition, condition_text_en: from.condition_text_en, outcome: from.outcome, effective_from: null, effective_to: null });
      return { code, version: created.version } satisfies RuleSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Approves a submitted version. The data layer refuses a role that cannot approve rules and the person who submitted it. */
export async function approveRule(input: DecideInput): Promise<ActionResult<RuleSummary>> {
  return runAction(
    async (ctx) => {
      const code = ruleCodeOf(input);
      const version = versionOf(input);
      const note = textOf(pickFields(input, ['note']).note);
      const decided = await approveRuleVersion(ctx, code, version, { note: nullIfEmpty(note) });
      return { code, version, effectiveFrom: decided.effective_from ?? undefined } satisfies RuleSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Rejects a submitted version, with a note. */
export async function rejectRule(input: DecideInput): Promise<ActionResult<RuleSummary>> {
  return runAction(
    async (ctx) => {
      const code = ruleCodeOf(input);
      const version = versionOf(input);
      const note = textOf(pickFields(input, ['note']).note);
      // The note is required to reject (the contract). A role that may not reject at all is refused by the data layer first,
      // so the denial is audited whatever the note says.
      const mayReject = approvalKindsFor(ctx.role, ctx.installMode).includes('rule');
      if (mayReject && note === '') throw new InvalidInputError('Note: a rejection needs a note.');
      await rejectRuleVersion(ctx, code, version, { note: nullIfEmpty(note) });
      return { code, version } satisfies RuleSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** The assistant's draft of a rule. Nothing is saved: the draft fills the builder, and the person saves it. */
export async function draftRuleFromText(input: AssistantDraftInput): Promise<ActionResult<AssistantRuleDraft>> {
  return runAction((ctx) => draftRuleWithAssistant(ctx, { text: pickText(input, 'text') ?? '', locale: pickText(input, 'locale') === 'ar' ? 'ar' : 'en' }));
}

/** Retires a rule: its active version ends today and any waiting draft is dropped. */
export async function retireRuleNow(input: RetireInput): Promise<ActionResult<RuleSummary>> {
  return runAction(
    async (ctx) => {
      const code = ruleCodeOf(input);
      const note = textOf(pickFields(input, ['note']).note);
      await retireRule(ctx, code, { note: nullIfEmpty(note) });
      return { code, version: 0 } satisfies RuleSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Classify the 20 most recent cases (AI review tab); handling unchanged. */
export async function runClassifierAction(input: RunClassifierInput): Promise<ActionResult<ClassifierRun>> {
  return runAction((ctx) => runClassifierReview(ctx, { count: 20, locale: pickText(input, 'locale') === 'ar' ? 'ar' : 'en' }), { revalidate: REVALIDATE });
}
