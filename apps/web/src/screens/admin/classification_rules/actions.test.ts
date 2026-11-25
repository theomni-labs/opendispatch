// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listRules, listRuleVersions } from '@/lib/data/rules';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { approveRule, draftNewVersion, draftRule, rejectRule, retireRuleNow, saveRuleDraft } from './actions';
import type { CreateRuleInput, Predicate } from './types';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions against the real data layer and the committed fixtures, with the demo store in a temp folder. The session is
// the only thing stood in for: requireRequestContext returns the context of the role the test picks.
const session = vi.hoisted(() => ({ role: 'administrator' as string | null, mode: 'private' as string, revalidate: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: session.revalidate }));
vi.mock('@/lib/data/context', async (original) => {
  const real = await original<typeof import('@/lib/data/context')>();
  return {
    ...real,
    requireRequestContext: async () => {
      if (session.role === null) throw new UnauthenticatedError();
      return contextOf(session.role as Role, session.mode as InstallMode);
    },
  };
});

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

// Screens may not import lib/data/internal (opendispatch/no-banned-import), so this
// mirrors lib/data/test-support.ts's resetGoTestState() locally.
async function resetGoTestState(): Promise<void> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') return;
  try {
    await fetch(`${url}/_internal/test/reset`, { method: 'POST' });
  } catch {
    // best-effort
  }
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  session.role = 'administrator';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetGoTestState();
});
afterEach(() => {
  errorLog.mockRestore();
});

async function adminContext(): Promise<RequestContext> {
  return contextOf('administrator', 'private');
}
const versions = async (code: string) => (await listRuleVersions(await adminContext(), code, { limit: 200 })).items;
const rule = async (code: string) => (await listRules(await adminContext(), { limit: 200 })).items.find((r) => r.rule_code === code);
// Seeded approvals share the action; skip them
const SEEDED_UNTIL = '2026-07-29';
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items.filter((e) => e.occurred_at > SEEDED_UNTIL);

const predicates: Predicate[] = [{ field: 'parties_involved', operator: 'gte', value: 5 }];
const body = { match: 'all', predicates, condition_text_en: 'Five or more parties', outcome: 'field_mandatory', effective_from: '', effective_to: '' } as const;
const create = (overrides: Partial<CreateRuleInput> = {}): CreateRuleInput => ({ ...body, rule_code: 'RULE-010', name_en: 'Five parties', name_ar: '', submit: false, ...overrides });
const asSupervisor = () => {
  session.role = 'dispatch_supervisor';
};

describe('draftRule', () => {
  it('drafts a rule with its first version, audits it, and refreshes the page in both languages', async () => {
    expect(await draftRule(create())).toMatchObject({ ok: true, data: { code: 'RULE-010', version: 1, created: true, submitted: false } });
    expect(await rule('RULE-010')).toMatchObject({ name_en: 'Five parties', status: 'draft', active_version: null });
    expect((await versions('RULE-010'))[0]).toMatchObject({ status: 'draft', outcome: 'field_mandatory', condition_text_en: 'Five or more parties', effective_from: null });
    expect((await events('rule.created')).at(0)).toMatchObject({ outcome: 'success', entity_id: 'RULE-010' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/classification-rules', '/ar/admin/classification-rules']);
  });

  it('drafts and submits in one press: the version is submitted and an approval is waiting', async () => {
    expect(await draftRule(create({ submit: true }))).toMatchObject({ ok: true, data: { submitted: true } });
    expect((await versions('RULE-010'))[0]?.status).toBe('submitted');
    expect((await events('rule.submitted')).at(0)?.outcome).toBe('success');
  });

  it.each([
    ['a code that is not a code', { rule_code: 'RULE-1' }, 'invalid'],
    ['a code that exists', { rule_code: 'RULE-001' }, 'conflict'],
    ['an empty name', { name_en: '' }, 'invalid'],
    ['no condition', { predicates: [] }, 'invalid'],
    ['an operator that is not one', { predicates: [{ field: 'parties_involved', operator: 'like', value: 5 }] }, 'invalid'],
    ['a field name that is not snake_case', { predicates: [{ field: 'Parties Involved', operator: 'eq', value: 5 }] }, 'invalid'],
    ['`in` with a single value', { predicates: [{ field: 'parties_involved', operator: 'in', value: 5 }] }, 'invalid'],
    ['an outcome that is not one', { outcome: 'maybe' }, 'invalid'],
    ['dates in the wrong order', { effective_from: '2026-10-05', effective_to: '2026-10-01' }, 'invalid'],
  ] as const)('refuses %s, with the data layer\'s English message, and drafts nothing', async (_name, change, code) => {
    const before = (await listRules(await adminContext(), { limit: 200 })).items.length;
    const result = await draftRule({ ...create(), ...change } as CreateRuleInput);
    expect(result).toMatchObject({ ok: false, code });
    if (!result.ok) expect(result.message).toMatch(/[A-Za-z]/);
    expect((await listRules(await adminContext(), { limit: 200 })).items.length).toBe(before);
  });
});

describe('saveRuleDraft', () => {
  it('saves the changes to a draft, and submits it for approval when asked', async () => {
    expect(await saveRuleDraft({ ...body, rule_code: 'RULE-003', version: 1, submit: false, condition_text_en: 'Three or more parties', predicates: [{ field: 'parties_involved', operator: 'gte', value: 3 }] })).toMatchObject({ ok: true, data: { submitted: false } });
    expect((await versions('RULE-003'))[0]).toMatchObject({ condition_text_en: 'Three or more parties', status: 'draft' });
    expect(await saveRuleDraft({ ...body, rule_code: 'RULE-003', version: 1, submit: true })).toMatchObject({ ok: true, data: { submitted: true } });
    expect((await versions('RULE-003'))[0]?.status).toBe('submitted');
  });

  it('refuses to change a version that is not a draft, as `conflict`', async () => {
    expect(await saveRuleDraft({ ...body, rule_code: 'RULE-001', version: 1, submit: false })).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('answers `not_found` for a version that does not exist and `invalid` for a code or version that is not one', async () => {
    expect(await saveRuleDraft({ ...body, rule_code: 'RULE-003', version: 9, submit: false })).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of [{ rule_code: 'toString' }, { rule_code: 42 }, { version: 'one' }, { version: 0 }]) expect(await saveRuleDraft({ ...body, rule_code: 'RULE-003', version: 1, submit: false, ...bad } as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('flow 1: the Administrator submits, a Dispatch Supervisor approves, nobody approves their own', () => {
  it('approves a submitted version as a Dispatch Supervisor: it becomes active from today and the old one is superseded', async () => {
    await saveRuleDraft({ ...body, rule_code: 'RULE-003', version: 1, submit: true });
    asSupervisor();
    const result = await approveRule({ rule_code: 'RULE-003', version: 1, note: 'Sample supports it' });
    expect(result).toMatchObject({ ok: true, data: { code: 'RULE-003', version: 1 } });
    expect(result.ok && result.data.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await rule('RULE-003')).toMatchObject({ status: 'active', active_version: 1 });
    expect((await versions('RULE-003'))[0]).toMatchObject({ status: 'active', decision_note: 'Sample supports it' });
    expect((await events('rule.approved')).at(0)?.outcome).toBe('success');
  });

  it('refuses an Administrator who tries to approve or reject, as `forbidden`, audits it as denied and changes nothing', async () => {
    await saveRuleDraft({ ...body, rule_code: 'RULE-003', version: 1, submit: true });
    expect(await approveRule({ rule_code: 'RULE-003', version: 1, note: '' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await rejectRule({ rule_code: 'RULE-003', version: 1, note: 'No' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await versions('RULE-003'))[0]?.status).toBe('submitted');
    expect((await events('rule.approved')).map((e) => e.outcome)).toEqual(['denied']);
    expect((await events('rule.rejected')).map((e) => e.outcome)).toEqual(['denied']);
  });

  it('audits an Administrator\'s rejection without a note as denied, not as a missing note', async () => {
    await saveRuleDraft({ ...body, rule_code: 'RULE-003', version: 1, submit: true });
    expect(await rejectRule({ rule_code: 'RULE-003', version: 1, note: '' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('rule.rejected')).map((e) => e.outcome)).toEqual(['denied']);
  });

  it('rejects with a note, which is required; the version is rejected and the rule stays as it was', async () => {
    await saveRuleDraft({ ...body, rule_code: 'RULE-003', version: 1, submit: true });
    asSupervisor();
    expect(await rejectRule({ rule_code: 'RULE-003', version: 1, note: '   ' })).toMatchObject({ ok: false, code: 'invalid' });
    expect((await versions('RULE-003'))[0]?.status).toBe('submitted');
    expect(await rejectRule({ rule_code: 'RULE-003', version: 1, note: 'Too broad' })).toMatchObject({ ok: true });
    expect((await versions('RULE-003'))[0]).toMatchObject({ status: 'rejected', decision_note: 'Too broad' });
    expect(await rule('RULE-003')).toMatchObject({ status: 'draft', active_version: null });
  });

  it('refuses a version that is not waiting for a decision, as `conflict`', async () => {
    asSupervisor();
    expect(await approveRule({ rule_code: 'RULE-003', version: 1, note: '' })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await approveRule({ rule_code: 'RULE-001', version: 1, note: '' })).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('refuses every other role and audits it', async () => {
    await saveRuleDraft({ ...body, rule_code: 'RULE-003', version: 1, submit: true });
    for (const role of ['dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      session.role = role;
      expect(await approveRule({ rule_code: 'RULE-003', version: 1, note: '' }), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await versions('RULE-003'))[0]?.status).toBe('submitted');
    expect((await events('rule.approved')).every((e) => e.outcome === 'denied')).toBe(true);
  });
});

describe('draftNewVersion (Draft new version, Revise as draft) and retireRuleNow', () => {
  it('drafts version 2 of an active rule with its conditions and no effective date, and refuses a second while one waits', async () => {
    expect(await draftNewVersion({ rule_code: 'RULE-001', version: 1 })).toMatchObject({ ok: true, data: { code: 'RULE-001', version: 2 } });
    const v2 = (await versions('RULE-001'))[1];
    expect(v2).toMatchObject({ status: 'draft', outcome: 'remote_eligible', effective_from: null, effective_to: null });
    expect(v2?.condition.predicates.length).toBeGreaterThan(1);
    expect(await draftNewVersion({ rule_code: 'RULE-001', version: 1 })).toMatchObject({ ok: false, code: 'conflict' });
    expect((await rule('RULE-001'))?.active_version).toBe(1);
  });

  it('revises a rejected version as a new draft (version 2)', async () => {
    await saveRuleDraft({ ...body, rule_code: 'RULE-003', version: 1, submit: true });
    asSupervisor();
    await rejectRule({ rule_code: 'RULE-003', version: 1, note: 'Too broad' });
    session.role = 'administrator';
    expect(await draftNewVersion({ rule_code: 'RULE-003', version: 1 })).toMatchObject({ ok: true, data: { version: 2 } });
    expect((await versions('RULE-003')).map((v) => v.status)).toEqual(['rejected', 'draft']);
  });

  it('answers `invalid` for a version that does not exist, and is refused and audited for a Supervisor and for a role with no access', async () => {
    expect(await draftNewVersion({ rule_code: 'RULE-001', version: 7 })).toMatchObject({ ok: false, code: 'invalid' });
    for (const role of ['dispatch_supervisor', 'dispatcher', 'change_approver'] as const) {
      session.role = role;
      expect(await draftNewVersion({ rule_code: 'RULE-001', version: 1 }), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events('rule.version_drafted')).map((e) => e.outcome)).toEqual(['denied', 'denied', 'denied']);
    expect(await versions('RULE-001')).toHaveLength(1);
  });

  it('retires a rule: its active version ends today, and a second retire is `conflict`', async () => {
    expect(await retireRuleNow({ rule_code: 'RULE-002', note: 'Replaced' })).toMatchObject({ ok: true });
    expect(await rule('RULE-002')).toMatchObject({ status: 'retired', active_version: null });
    expect((await versions('RULE-002'))[0]?.status).toBe('retired');
    expect(await retireRuleNow({ rule_code: 'RULE-002', note: '' })).toMatchObject({ ok: false, code: 'conflict' });
    session.role = 'dispatch_supervisor';
    expect(await retireRuleNow({ rule_code: 'RULE-004', note: '' })).toMatchObject({ ok: false, code: 'forbidden' });
    // same second: check the set, not the order
    expect((await events('rule.retired')).map((e) => e.outcome).sort()).toEqual(['denied', 'success']);
  });
});

describe('every action', () => {
  it('answers `unauthenticated` with no session, and touches nothing', async () => {
    session.role = null;
    expect(await draftRule(create())).toMatchObject({ ok: false, code: 'unauthenticated' });
    expect(await approveRule({ rule_code: 'RULE-003', version: 1, note: '' })).toMatchObject({ ok: false, code: 'unauthenticated' });
    expect(await events('rule.created')).toHaveLength(0);
  });

  it('refuses input that is not an object, and never forwards a field it does not name', async () => {
    for (const bad of [null, undefined, 'x', 42, [], {}]) expect(await draftRule(bad as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
    const result = await draftRule({ ...create(), role: 'administrator', tenant_id: 'x', status: 'active', active_version: 1, first_version: { outcome: 'remote_eligible' } } as never);
    expect(result).toMatchObject({ ok: true });
    expect(await rule('RULE-010')).toMatchObject({ status: 'draft', active_version: null });
    expect((await versions('RULE-010'))[0]?.outcome).toBe('field_mandatory');
  });

  it('names the caller in the audit event, whatever the input claims', async () => {
    await draftRule({ ...create(), actor_user_id: 'forged' } as never);
    expect((await events('rule.created'))[0]?.actor_user_id).toBe((await adminContext()).userId);
  });

  it('returns a reference ODP- and 8 hex characters for an unexpected error, logs only that, and leaks no input', async () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError('boom: password=hunter2 rule=secret-rule');
      },
    });
    const result = await draftRule(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result) + errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|secret-rule|boom/);
  });
});

describe('the server-built context rule in this file', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
  const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

  it('is a use-server file whose exports are all async functions', () => {
    expect(source.trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect([...new Set(exported)]).toEqual(['async']);
    expect(exported).toHaveLength(8);
  });

  it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
    const inputTypes = types.slice(types.indexOf('What the browser sends'));
    const fields = [...inputTypes.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
    expect(fields.length).toBeGreaterThan(12);
    for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
  });
});
