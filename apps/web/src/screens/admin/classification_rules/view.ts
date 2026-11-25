// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Classification Rules screen: reads through lib/data with the request context and returns plain data
//. Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads: listRules, listRuleVersions (one call per rule), listApprovals (subject_type rule_version), listUserDisplayNames (the
// names of who drafted, submitted and decided: a Dispatch Supervisor may not list users, so this is the one lookup they have).
// The history of a rule comes from its versions (drafted, submitted, decided, note), not from the audit log, which the
// Supervisor cannot read.

import { checkApproval } from '@/lib/access';
import { listApprovals } from '@/lib/data/notifications';
import { listRules, listRuleVersions } from '@/lib/data/rules';
import type { RequestContext } from '@/lib/data/guard';
import { listUserDisplayNames } from '@/lib/data/users';
import { listCaseTypes } from '@/lib/data/cases';
import { getClassifierReview } from '@/lib/data/case-suggestions';
import { caseTypeName, customerText } from '@/lib/data/wording';
import type { Approval, ClassificationRule, DataSource, PageInfo, RuleVersion } from '@/lib/types';
import { OUTCOMES, type AiReviewView, type ApprovalDenial, type ApprovalRow, type Condition, type HistoryItem, type Operator, type Outcome, type OpenRule, type Predicate, type PredicateValue, type RuleRow, type RuleStatus, type VersionRow, type VersionStatus } from './types';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface RulesQuery {
  readonly q?: string | undefined;
  readonly status?: RuleStatus | undefined;
  readonly outcome?: Outcome | undefined;
  /** `?rule=`: a rule code, or `new`. */
  readonly rule?: string | undefined;
  /** `?version=`: the version of that rule the drawer shows. */
  readonly version?: number | undefined;
}

export interface RulesView {
  /** The data_source of every record shown. */
  readonly sources: readonly DataSource[];
  readonly total: number;
  readonly counts: { readonly active: number; readonly draft: number; readonly pending: number };
  /** Every rule (the table filters and searches them in the client's address-driven view: this list is already filtered). */
  readonly rules: readonly RuleRow[];
  readonly approvals: readonly ApprovalRow[];
  readonly pendingApprovals: number;
  /** The case types a rule may test (the values of the "Case type" field). */
  readonly caseTypes: readonly string[];
  /** Their display names, per language. */
  readonly caseTypeLabels: Readonly<Record<'en' | 'ar', Readonly<Record<string, string>>>>;
  /** The rule `?rule=` opens; undefined when there is none, it is `new`, or it does not exist. */
  readonly open: OpenRule | undefined;
  /** `?rule=` named a rule that does not exist: the screen says so above the list. */
  readonly unknownRule: boolean;
  /** Every rule as CSV cells, for Export. */
  readonly exportHeader: readonly string[];
  readonly exportRows: readonly (readonly string[])[];
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

const labelsOf = (types: readonly string[], locale: 'en' | 'ar'): Record<string, string> => Object.fromEntries(types.map((t) => [t, caseTypeName(t, locale)]));

const isOutcome = (value: string): value is Outcome => (OUTCOMES as readonly string[]).includes(value);

/** Display names for a set of user ids, in chunks the data layer accepts (100). A person it does not know has no name. */
async function displayNames(ctx: RequestContext, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 100) {
    for (const person of (await listUserDisplayNames(ctx, unique.slice(i, i + 100))).items) out.set(person.id, person.display_name);
  }
  return out;
}

const conditionOf = (version: RuleVersion): Condition => ({
  match: version.condition.match,
  predicates: version.condition.predicates.map((p): Predicate => ({ field: p.field, operator: p.operator as Operator, value: (Array.isArray(p.value) ? [...p.value] : p.value) as PredicateValue })),
});

function versionRow(version: RuleVersion, names: ReadonlyMap<string, string>): VersionRow {
  const name = (id: string | null | undefined): string | null => (id === null || id === undefined ? null : (names.get(id) ?? null));
  return {
    version: version.version,
    status: version.status as VersionStatus,
    outcome: isOutcome(version.outcome) ? version.outcome : 'field_preferred',
    condition: conditionOf(version),
    conditionText: customerText(version.condition_text_en),
    effectiveFrom: version.effective_from ?? null,
    effectiveTo: version.effective_to ?? null,
    createdAt: version.created_at,
    createdBy: name(version.created_by),
    submittedAt: version.submitted_at ?? null,
    decidedAt: version.decided_at ?? null,
    decidedBy: name(version.decided_by_user_id),
    note: version.decision_note === null || version.decision_note === undefined ? null : customerText(version.decision_note),
  };
}

/** The version a rule row stands for: the active one; a retired rule, its last retired one; otherwise the newest. */
function currentOf(rule: ClassificationRule, versions: readonly VersionRow[]): VersionRow {
  const newest = versions.at(-1) as VersionRow;
  const active = versions.find((v) => v.version === rule.active_version && v.status === 'active');
  if (active !== undefined) return active;
  if (rule.status === 'retired') return [...versions].reverse().find((v) => v.status === 'retired') ?? newest;
  return newest;
}

/** Approve and Reject are not available: the role cannot approve a rule, or the person submitted the version themselves. */
function denialOf(ctx: RequestContext, requesterUserId: string | null | undefined): ApprovalDenial {
  const decision = checkApproval({ role: ctx.role, requesterUserId: requesterUserId ?? 'system', approverUserId: ctx.userId, kind: 'rule', installMode: ctx.installMode });
  if (decision.allowed) return null;
  return requesterUserId === ctx.userId ? 'own' : 'role';
}

export function historyOf(versions: readonly VersionRow[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const v of versions) {
    items.push({ id: `${v.version}:created`, kind: 'created', version: v.version, at: v.createdAt, name: v.createdBy, note: null });
    if (v.submittedAt !== null) items.push({ id: `${v.version}:submitted`, kind: 'submitted', version: v.version, at: v.submittedAt, name: null, note: null });
    if (v.decidedAt !== null) {
      const rejected = v.status === 'rejected';
      items.push({ id: `${v.version}:decided`, kind: rejected ? 'rejected' : 'approved', version: v.version, at: v.decidedAt, name: v.decidedBy, note: v.note });
      if (!rejected && v.effectiveFrom !== null) items.push({ id: `${v.version}:effect`, kind: 'effect', version: v.version, at: v.effectiveFrom, name: null, note: null });
    }
    if (v.status === 'retired' && v.effectiveTo !== null) items.push({ id: `${v.version}:retired`, kind: 'retired', version: v.version, at: v.effectiveTo, name: null, note: null });
  }
  // A version's events happen in this order (a seeded record may carry timestamps that disagree), and the versions in their own.
  const rank: Readonly<Record<HistoryItem['kind'], number>> = { created: 0, submitted: 1, approved: 2, rejected: 2, effect: 3, retired: 4 };
  return items.sort((a, b) => a.version - b.version || rank[a.kind] - rank[b.kind]);
}

export async function loadRulesView(ctx: RequestContext, query: RulesQuery): Promise<RulesView> {
  const rules = await listAll((cursor) => listRules(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  // Known N+1: one listRuleVersions call per rule. Now that rules.ts calls Go over
  // HTTP, this is a real cost; run the calls in parallel rather than silently eating a longer
  // load, but a batch endpoint (like getLeaveCoverageEffects) is the real fix.
  const versionLists = await Promise.all(rules.map((rule) => listAll((cursor) => listRuleVersions(ctx, rule.rule_code, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }))));
  const versionsByCode = new Map<string, RuleVersion[]>(rules.map((rule, i) => [rule.rule_code, versionLists[i] ?? []]));
  const approvals = (await listAll((cursor) => listApprovals(ctx, { limit: PAGE, subject_type: 'rule_version', ...(cursor === undefined ? {} : { cursor }) }))) as Approval[];

  const allVersions = [...versionsByCode.values()].flat();
  const names = await displayNames(ctx, [...allVersions.flatMap((v) => [v.created_by, v.decided_by_user_id]), ...approvals.flatMap((a) => [a.created_by, a.decided_by_user_id])]);

  const rows = new Map<string, { row: RuleRow; versions: VersionRow[] }>();
  for (const rule of rules) {
    const versions = (versionsByCode.get(rule.rule_code) ?? []).map((v) => versionRow(v, names));
    if (versions.length === 0) continue;
    const current = currentOf(rule, versions);
    const waiting = versions.filter((v) => (v.status === 'draft' || v.status === 'submitted') && v.version > current.version).at(-1);
    const working = versions.filter((v) => v.status === 'draft' || v.status === 'submitted').at(-1);
    rows.set(rule.rule_code, {
      versions,
      row: {
        code: rule.rule_code,
        name: customerText(rule.name_en),
        nameAr: rule.name_ar ?? null,
        sourceNote: rule.source_note === null || rule.source_note === undefined ? null : customerText(rule.source_note),
        ruleStatus: rule.status,
        current,
        next: waiting === undefined ? null : waiting.version,
        working: working === undefined ? null : working.version,
      },
    });
  }

  const codeOfVersion = new Map<string, { code: string; version: number }>();
  for (const [code, list] of versionsByCode) for (const v of list) codeOfVersion.set(v.id, { code, version: v.version });
  const approvalRows: ApprovalRow[] = approvals.flatMap((a) => {
    const found = codeOfVersion.get(a.subject_id);
    if (found === undefined) return [];
    return [
      {
        id: a.id,
        code: found.code,
        version: found.version,
        summary: customerText(a.summary_en),
        status: a.status,
        requestedAt: a.requested_at,
        decidedBy: a.decided_by_user_id === null || a.decided_by_user_id === undefined ? null : (names.get(a.decided_by_user_id) ?? null),
        denial: a.status === 'pending' ? denialOf(ctx, a.created_by) : null,
      } satisfies ApprovalRow,
    ];
  });
  // Waiting requests first, then the newest decisions.
  approvalRows.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.requestedAt.localeCompare(a.requestedAt));

  const everyRow = [...rows.values()].map((entry) => entry.row);
  const matches = (row: RuleRow): boolean => {
    if (query.status !== undefined && row.current.status !== query.status) return false;
    if (query.outcome !== undefined && row.current.outcome !== query.outcome) return false;
    if (query.q === undefined || query.q.trim() === '') return true;
    return `${row.code} ${row.name} ${row.nameAr ?? ''} ${row.current.conditionText}`.toLowerCase().includes(query.q.trim().toLowerCase());
  };

  let open: OpenRule | undefined;
  const asked = query.rule !== undefined && query.rule !== 'new' ? rows.get(query.rule) : undefined;
  if (asked !== undefined) {
    const versions = asked.versions;
    const wanted = query.version === undefined ? undefined : versions.find((v) => v.version === query.version);
    const shown = wanted ?? versions.find((v) => v.version === asked.row.working) ?? asked.row.current;
    const submitted = approvals.find((a) => a.status === 'pending' && codeOfVersion.get(a.subject_id)?.code === asked.row.code && codeOfVersion.get(a.subject_id)?.version === shown.version);
    open = { rule: asked.row, versions, shown: shown.version, history: historyOf(versions), denial: shown.status === 'submitted' ? denialOf(ctx, submitted?.created_by) : null };
  }

  const caseTypes = (await listAll((cursor) => listCaseTypes(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }))).map((c) => c.name_en);
  const pendingApprovals = approvalRows.filter((a) => a.status === 'pending').length;

  return {
    sources: [...new Set<DataSource>([...rules, ...allVersions].map((r) => r.data_source))],
    total: everyRow.length,
    counts: { active: everyRow.filter((r) => r.current.status === 'active').length, draft: everyRow.filter((r) => r.current.status === 'draft').length, pending: pendingApprovals },
    rules: everyRow.filter(matches),
    approvals: approvalRows,
    pendingApprovals,
    caseTypes,
    caseTypeLabels: { en: labelsOf(caseTypes, 'en'), ar: labelsOf(caseTypes, 'ar') },
    open,
    unknownRule: query.rule !== undefined && query.rule !== 'new' && asked === undefined,
    exportHeader: ['rule_code', 'name_en', 'name_ar', 'status', 'version', 'outcome', 'condition_text_en', 'effective_from', 'effective_to'],
    exportRows: everyRow.map((r) => [r.code, r.name, r.nameAr ?? '', r.current.status, String(r.current.version), r.current.outcome, r.current.conditionText, r.current.effectiveFrom ?? '', r.current.effectiveTo ?? '']),
  };
}

/** The AI review tab: suggestions against the rules, last 7 days. */
export async function loadAiReview(ctx: RequestContext, only: 'all' | 'disagreements', locale: string): Promise<AiReviewView> {
  const review = await getClassifierReview(ctx, { days: 7, only, limit: 200 });
  const pct = (n: number) => (review.cases_compared === 0 ? null : Math.round((n / review.cases_compared) * 100));
  return {
    compared: review.cases_compared,
    handlingPct: pct(review.handling_agreed),
    severityPct: pct(review.severity_agreed),
    reviewed: review.reviewed,
    only,
    provider: review.items[0] === undefined ? null : [review.items[0].provider, review.items[0].model].filter((s) => s !== undefined && s !== '').join(' · '),
    sources: [review.data_source],
    rows: review.items.map((item) => ({
      id: item.case_id,
      caseNumber: item.case_number,
      ai: { handling: item.suggestion.handling, severity: item.suggestion.severity },
      rule: { handling: item.rule.handling, ruleName: item.rule.rule_code === null ? null : ((locale === 'ar' ? item.rule.rule_name_ar : null) ?? item.rule.rule_name_en ?? item.rule.rule_code) },
      agrees: item.agrees_with_rules,
      pct: Math.round(item.suggestion.confidence * 100),
      reason: item.suggestion.reason,
      review: item.review === null ? null : item.review.decision,
    })),
  };
}
