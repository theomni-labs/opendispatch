// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { RuleVersionWrite } from '@/lib/types';
import { listAuditEvents } from './audit';
import { ConflictError, DataError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { listApprovals } from './notifications';
import {
  approveRuleVersion,
  createRule,
  createRuleVersionDraft,
  getRule,
  listRuleVersions,
  listRules,
  rejectRuleVersion,
  retireRule,
  submitRuleVersion,
  updateRuleVersionDraft,
} from './rules';
import { ctxFor, dataSnapshot, expectValid, fieldShareForTest, JUNK_IDS, withTempDemoState } from './test-support';

withTempDemoState();

const admin = () => ctxFor('administrator');
const supervisor = () => ctxFor('dispatch_supervisor');

const severeRule: RuleVersionWrite = {
  condition: { match: 'all', predicates: [{ field: 'severity', operator: 'eq', value: 'severe' }] },
  condition_text_en: 'Severity is severe',
  outcome: 'field_mandatory',
};

async function auditActions(outcome?: 'success' | 'denied') {
  const list = await listAuditEvents(admin(), outcome === undefined ? {} : { outcome });
  return list.items.map((e) => `${e.action}:${e.outcome}`);
}

function codeOfError(error: unknown): string {
  return error instanceof DataError ? error.code : `not a DataError: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
}

/** Async form of expectJunkIdsInvalid/expectJunkIdsForbidden (test-support.ts): rules.ts's writes are Go calls now. */
async function expectJunkCodesInvalid(call: (id: never) => Promise<unknown>, ids: readonly unknown[] = JUNK_IDS): Promise<void> {
  for (const id of ids) {
    let code = 'did not throw';
    try {
      await call(id as never);
    } catch (error) {
      code = codeOfError(error);
    }
    expect(code, `id ${JSON.stringify(id) ?? String(id)}`).toBe('invalid');
  }
}

async function expectJunkCodesForbidden(call: (id: never) => Promise<unknown>, ids: readonly unknown[] = JUNK_IDS): Promise<void> {
  const audits = (await listAuditEvents(admin(), { outcome: 'denied', limit: 200 })).items.length;
  for (const id of ids) {
    let code = 'did not throw';
    try {
      await call(id as never);
    } catch (error) {
      code = codeOfError(error);
    }
    expect(code, `id ${JSON.stringify(id) ?? String(id)}`).toBe('forbidden');
  }
  expect((await listAuditEvents(admin(), { outcome: 'denied', limit: 200 })).items.length).toBe(audits + ids.length);
}

describe('reading rules', () => {
  it('lists the ten fixture rules with their Draft and Active markings and validates against the contract', async () => {
    const list = await listRules(admin());
    expect(list.items.map((r) => r.rule_code)).toEqual(['RULE-001', 'RULE-002', 'RULE-003', 'RULE-003A', 'RULE-004', 'RULE-005', 'RULE-006', 'RULE-007', 'RULE-008', 'RULE-009']);
    expect((await listRules(admin(), { status: 'active' })).items.map((r) => r.rule_code)).toEqual(['RULE-001', 'RULE-002', 'RULE-004', 'RULE-005']);
    expect((await listRules(admin(), { status: 'draft' })).items).toHaveLength(6);
    expectValid('ClassificationRuleList', list);
    expectValid('ClassificationRule', await getRule(admin(), 'RULE-001'));
    const versions = await listRuleVersions(admin(), 'RULE-003');
    expect(versions.items[0]?.status).toBe('draft');
    expectValid('RuleVersionList', versions);
  });

  it('lets the Dispatch Supervisor view the rules and keeps everyone else out', async () => {
    expect((await listRules(supervisor())).items).toHaveLength(10);
    for (const role of ['planner', 'dispatcher', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      await expect(listRules(ctxFor(role))).rejects.toThrow(ForbiddenError);
    }
  });

  it('answers not found and invalid input clearly', async () => {
    await expect(getRule(admin(), 'RULE-999')).rejects.toThrow(NotFoundError);
    await expect(getRule(admin(), 'rule-1')).rejects.toThrow(InvalidInputError);
    await expect(listRules(admin(), { status: 'bogus' as 'draft' })).rejects.toThrow(InvalidInputError);
  });
});

describe('flow 1: drafting, submitting, approving and the field share', () => {
  it('keeps a new rule as a Draft that changes nothing until a Supervisor approves it', async () => {
    const before = await fieldShareForTest(admin());
    const created = await createRule(admin(), { rule_code: 'RULE-010', name_en: 'Severe: field mandatory', first_version: severeRule });
    expect(created.status).toBe('draft');
    expect(created.active_version).toBeNull();
    const [version] = (await listRuleVersions(admin(), 'RULE-010')).items;
    expect(version?.status).toBe('draft');
    expect(version?.data_source).toBe('SYNTHETIC');
    expectValid('RuleVersion', version);
    expect((await fieldShareForTest(admin())).rule_set_version).toBe(before.rule_set_version);

    await submitRuleVersion(admin(), 'RULE-010', 1);
    expect((await fieldShareForTest(admin())).rule_set_version).toBe(before.rule_set_version);
    const approvals = (await listApprovals(admin(), { subject_type: 'rule_version', limit: 200 })).items.filter((a) => a.subject_id === version?.id);
    expect(approvals.map((a) => a.status)).toEqual(['pending']);

    const approved = await approveRuleVersion(supervisor(), 'RULE-010', 1, { note: 'Agreed.' });
    expect(approved.status).toBe('active');
    expect(approved.effective_from).toBe('2026-09-13');
    expect(approved.decided_by_user_id).toBe(supervisor().userId);
    expect(await getRule(admin(), 'RULE-010')).toMatchObject({ status: 'active', active_version: 1 });
    expect((await listApprovals(admin(), { subject_type: 'rule_version', limit: 200 })).items.filter((a) => a.subject_id === version?.id).map((a) => a.status)).toEqual(['approved']);
    const after = await fieldShareForTest(admin());
    expect(after.rule_set_version).not.toBe(before.rule_set_version);
    expect(after.active_rules.map((r) => r.rule_code)).toContain('RULE-010');
    expectValid('ClassificationRule', await getRule(admin(), 'RULE-010'));
    expect(await auditActions()).toContain('rule.approved:success');
    expect(await auditActions()).toContain('rule.submitted:success');
    expect(await auditActions()).toContain('rule.created:success');
  });

  it('raises the field share when a Field mandatory rule is approved (RULE-008, Unlisted)', async () => {
    const before = await fieldShareForTest(admin());
    await submitRuleVersion(admin(), 'RULE-008', 1);
    await approveRuleVersion(supervisor(), 'RULE-008', 1);
    const after = await fieldShareForTest(admin());
    expect(after.overall_field_share).toBeGreaterThan(before.overall_field_share ?? 1);
    for (const zone of after.zones) {
      const was = before.zones.find((z) => z.zone_id === zone.zone_id);
      expect(zone.field_share ?? 0).toBeGreaterThanOrEqual(was?.field_share ?? 1);
    }
  });

  it('changes the split when an active rule is retired', async () => {
    const before = await fieldShareForTest(admin());
    await retireRule(admin(), 'RULE-001', { note: 'Simple cases need a second look.' });
    const afterRemote = await fieldShareForTest(admin());
    expect(afterRemote.overall_field_share).toBeGreaterThan(before.overall_field_share ?? 1);
    expect(afterRemote.active_rules.map((r) => r.rule_code)).not.toContain('RULE-001');

    await retireRule(admin(), 'RULE-005');
    const afterMandatory = await fieldShareForTest(admin());
    expect(afterMandatory.overall_field_share).toBeLessThan(afterRemote.overall_field_share ?? 0);
    expect(await getRule(admin(), 'RULE-005')).toMatchObject({ status: 'retired', active_version: null });
    expect((await listRuleVersions(admin(), 'RULE-005')).items[0]).toMatchObject({ status: 'retired', effective_to: '2026-09-13' });
    expect(await auditActions()).toContain('rule.retired:success');
    await expect(retireRule(admin(), 'RULE-005')).rejects.toThrow(ConflictError);
  });

  it('weights Field preferred by the isolated assumption', async () => {
    const share = await fieldShareForTest(admin());
    const zone = share.zones[0];
    expect(share.field_preferred_weight).toBe(0.5);
    const o = zone?.outcomes;
    expect(o).toBeDefined();
    const expected = ((o?.field_mandatory ?? 0) + share.field_preferred_weight * (o?.field_preferred ?? 0)) / (zone?.case_count ?? 1);
    expect(zone?.field_share).toBeCloseTo(expected, 10);
  });

  it('previews a submitted version without activating it', async () => {
    await submitRuleVersion(admin(), 'RULE-008', 1);
    const draftId = (await listRuleVersions(admin(), 'RULE-008')).items[0]?.id;
    const active = await fieldShareForTest(admin());
    const preview = await fieldShareForTest(admin(), { ruleVersionId: draftId });
    expect(preview.rule_set_version.startsWith('preview-')).toBe(true);
    expect(preview.overall_field_share).toBeGreaterThan(active.overall_field_share ?? 1);
    expect((await fieldShareForTest(admin())).rule_set_version).toBe(active.rule_set_version);
    await expect(fieldShareForTest(admin(), { ruleVersionId: 'f0f0f0f0-0000-4000-8000-000000000000' })).rejects.toThrow(NotFoundError);
  });

  it('does not let a rule with a future effective date change today’s split', async () => {
    const future: RuleVersionWrite = { ...severeRule, effective_from: '2026-12-01' };
    await createRule(admin(), { rule_code: 'RULE-011', name_en: 'Future rule', first_version: future });
    const before = await fieldShareForTest(admin());
    await submitRuleVersion(admin(), 'RULE-011', 1);
    await approveRuleVersion(supervisor(), 'RULE-011', 1);
    expect((await fieldShareForTest(admin())).rule_set_version).toBe(before.rule_set_version);
    expect((await fieldShareForTest(admin(), { date: '2026-12-02' })).active_rules.map((r) => r.rule_code)).toContain('RULE-011');
  });

  it('supersedes the previous active version when a new version is approved', async () => {
    const next: RuleVersionWrite = { ...severeRule, outcome: 'field_preferred', condition_text_en: 'Injury present, softened' };
    await createRuleVersionDraft(admin(), 'RULE-002', next);
    await expect(createRuleVersionDraft(admin(), 'RULE-002', next)).rejects.toThrow(ConflictError);
    await submitRuleVersion(admin(), 'RULE-002', 2);
    await approveRuleVersion(supervisor(), 'RULE-002', 2);
    const statuses = (await listRuleVersions(admin(), 'RULE-002')).items.map((row) => `${row.version}:${row.status}`);
    expect(statuses).toEqual(['1:superseded', '2:active']);
    expect((await getRule(admin(), 'RULE-002')).active_version).toBe(2);
  });

  it('rejects a version and leaves the rule as a Draft', async () => {
    await submitRuleVersion(admin(), 'RULE-003', 1);
    const rejected = await rejectRuleVersion(supervisor(), 'RULE-003', 1, { note: 'Needs more evidence.' });
    expect(rejected.status).toBe('rejected');
    expect(rejected.decision_note).toBe('Needs more evidence.');
    expect((await getRule(admin(), 'RULE-003')).status).toBe('draft');
    await expect(approveRuleVersion(supervisor(), 'RULE-003', 1)).rejects.toThrow(ConflictError);
    expect(await auditActions()).toContain('rule.rejected:success');
  });

  it('only changes drafts and only approves what was submitted', async () => {
    await expect(approveRuleVersion(supervisor(), 'RULE-003', 1)).rejects.toThrow(ConflictError);
    const updated = await updateRuleVersionDraft(admin(), 'RULE-003', 1, { ...severeRule, condition_text_en: 'Three parties (changed)' });
    expect(updated.condition_text_en).toBe('Three parties (changed)');
    await submitRuleVersion(admin(), 'RULE-003', 1);
    await expect(updateRuleVersionDraft(admin(), 'RULE-003', 1, severeRule)).rejects.toThrow(ConflictError);
    await expect(submitRuleVersion(admin(), 'RULE-003', 1)).rejects.toThrow(ConflictError);
  });
});

describe('who may do what', () => {
  it('keeps the Supervisor from drafting, submitting or retiring, and audits the denial', async () => {
    await expect(createRule(supervisor(), { rule_code: 'RULE-012', name_en: 'x', first_version: severeRule })).rejects.toThrow(ForbiddenError);
    await expect(submitRuleVersion(supervisor(), 'RULE-003', 1)).rejects.toThrow(ForbiddenError);
    await expect(retireRule(supervisor(), 'RULE-001')).rejects.toThrow(ForbiddenError);
    expect(await auditActions('denied')).toEqual(expect.arrayContaining(['rule.created:denied', 'rule.submitted:denied', 'rule.retired:denied']));
  });

  it('keeps the Administrator from approving, and audits the denial', async () => {
    await submitRuleVersion(admin(), 'RULE-003', 1);
    await expect(approveRuleVersion(admin(), 'RULE-003', 1)).rejects.toThrow(ForbiddenError);
    expect((await getRule(admin(), 'RULE-003')).status).toBe('draft');
    expect(await auditActions('denied')).toContain('rule.approved:denied');
  });

  it('keeps everyone else out of the writes', async () => {
    for (const role of ['planner', 'dispatcher', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      await expect(approveRuleVersion(ctxFor(role), 'RULE-003', 1)).rejects.toThrow(ForbiddenError);
      await expect(createRule(ctxFor(role), { rule_code: 'RULE-013', name_en: 'x', first_version: severeRule })).rejects.toThrow(ForbiddenError);
    }
  });

  // "Never lets anyone approve their own submission" (own_request) needs one user id under two
  // roles: Administrator to submit, Dispatch Supervisor to approve. ctxFor's fixture users are
  // one role each, and Go resolves the caller's user id itself from (role, zone) -- never from
  // anything the caller claims -- so this can no longer be forged from here the way the old sync
  // store let it (upsert('Approval', { created_by: ... })). That exact scenario is covered
  // server-side, with a hand-built request context that holds both roles under one user id, by
  // Go's TestRules_NobodyApprovesOwnSubmission (apps/api-go/internal/business/rules_test.go).
  //
  // What is still reachable from here -- that a real pending request records its real submitter,
  // and that only Dispatch Supervisor may decide it at all -- is covered above ("keeps the
  // Administrator from approving") and in the pending-approval assertion elsewhere in this file.

  it('refuses a second Supervisor role only when the install has no such role', async () => {
    await expect(listRules(ctxFor('dispatch_supervisor', { installMode: 'shared' }))).resolves.not.toThrow();
  });
});

describe('the zone scope of the field share', () => {
  it('shows a Planner only their zones and the remote pool every zone', async () => {
    const planner = await fieldShareForTest(ctxFor('planner'));
    expect(planner.zones).toHaveLength(3);
    expect((await fieldShareForTest(ctxFor('remote_team_lead'))).zones).toHaveLength(8);
    expect((await fieldShareForTest(ctxFor('dispatcher'))).zones).toHaveLength(2);
    expect((await fieldShareForTest(admin())).zones).toHaveLength(8);
    await expect(fieldShareForTest(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
  });

  it('narrows to one zone on request', async () => {
    const all = await fieldShareForTest(admin());
    const one = await fieldShareForTest(admin(), { zoneId: all.zones[2]?.zone_id });
    expect(one.zones).toHaveLength(1);
    expect(one.zones[0]?.field_share).toBe(all.zones[2]?.field_share);
  });
});

describe('persistence', () => {
  it('keeps an approval across a fresh module instance and audits it', async () => {
    await submitRuleVersion(admin(), 'RULE-008', 1);
    await approveRuleVersion(supervisor(), 'RULE-008', 1, { note: 'Yes.' });
    vi.resetModules();
    const fresh = await import('./rules');
    const freshAudit = await import('./audit');
    expect(await fresh.getRule(admin(), 'RULE-008')).toMatchObject({ status: 'active', active_version: 1 });
    const events = (await freshAudit.listAuditEvents(admin(), { action: 'rule.approved' })).items;
    expect(events[0]).toMatchObject({ entity_type: 'rule_version', outcome: 'success', actor_user_id: supervisor().userId });
    expect(events[0]?.detail).toMatchObject({ rule_code: 'RULE-008', version: 1 });
    expectValid('AuditEvent', events[0]);
    expect((await fieldShareForTest(admin())).active_rules.map((r) => r.rule_code)).toContain('RULE-008');
  });

  it('refuses input the contract does not allow', async () => {
    await expect(createRule(admin(), { rule_code: 'RULE-1', name_en: 'x', first_version: severeRule })).rejects.toThrow(InvalidInputError);
    await expect(createRule(admin(), { rule_code: 'RULE-014', name_en: 'x', first_version: { ...severeRule, outcome: 'maybe' } })).rejects.toThrow(InvalidInputError);
    await expect(createRule(admin(), { rule_code: 'RULE-014', name_en: 'x', first_version: { ...severeRule, condition: { match: 'all', predicates: [] } } })).rejects.toThrow(InvalidInputError);
    await expect(createRule(admin(), { rule_code: 'RULE-001', name_en: 'x', first_version: severeRule })).rejects.toThrow(ConflictError);
    await expect(createRule(admin(), { rule_code: 'RULE-014', name_en: 'x', role: 'planner', first_version: severeRule })).rejects.toThrow(InvalidInputError);
  });
});

// Review finding M4: a rule is named by its code (RULE-003), not a UUID. A code that is not text, or is not of that shape,
// is refused with `invalid` after the role check; a caller who may not write gets `forbidden`, audited, whatever the code is.
describe('crafted rule codes (review M4)', () => {
  it('refuses junk codes on the reads and writes for an Administrator, and changes nothing', async () => {
    const ctx = admin();
    const before = dataSnapshot();
    await expectJunkCodesInvalid((code) => getRule(ctx, code));
    await expectJunkCodesInvalid((code) => listRuleVersions(ctx, code));
    await expectJunkCodesInvalid((code) => createRuleVersionDraft(ctx, code, {}));
    await expectJunkCodesInvalid((code) => updateRuleVersionDraft(ctx, code, 1, {}));
    await expectJunkCodesInvalid((code) => submitRuleVersion(ctx, code, 1));
    await expectJunkCodesInvalid((code) => retireRule(ctx, code, {}));
    expect(dataSnapshot()).toBe(before);
    // an array or an object that prints as a valid code is not a valid code
    await expect(getRule(ctx, ['RULE-001'] as never)).rejects.toThrow(InvalidInputError);
    await expect(getRule(ctx, { toString: () => 'RULE-001' } as never)).rejects.toThrow(InvalidInputError);
  });

  it('refuses a junk code for the approver, a junk version for a valid code, and forbids a caller who may not decide', async () => {
    const approver = ctxFor('dispatch_supervisor');
    await expectJunkCodesInvalid((code) => approveRuleVersion(approver, code, 1, {}));
    await expectJunkCodesInvalid((code) => rejectRuleVersion(approver, code, 1, {}));
    for (const version of [0, -1, 1.5, Number.NaN, '1', null, undefined, {}]) await expect(approveRuleVersion(approver, 'RULE-003', version as never, {})).rejects.toThrow(InvalidInputError);
    const viewer = ctxFor('viewer_auditor');
    await expectJunkCodesForbidden((code) => createRuleVersionDraft(viewer, code, {}));
    await expectJunkCodesForbidden((code) => updateRuleVersionDraft(viewer, code, 1, {}));
    await expectJunkCodesForbidden((code) => submitRuleVersion(viewer, code, 1));
    await expectJunkCodesForbidden((code) => retireRule(viewer, code, {}));
  });
});
