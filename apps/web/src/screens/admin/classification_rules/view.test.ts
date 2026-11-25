// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { createRuleVersionDraft, listRules, retireRule, submitRuleVersion } from '@/lib/data/rules';
import { historyOf, loadRulesView } from './view';

// The server side of the screen against the real data layer and the committed fixtures (10 rules: 4 active, 6 draft; 4 approved
// rule approvals). Nobody is signed in: the contexts are built the way ModuleRoute builds them from the demo cookie.
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

beforeEach(async () => {
  await resetGoTestState();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');
const supervisor = () => ctxOf('dispatch_supervisor');

describe('loadRulesView: the rules', () => {
  it('counts the rules by the status of the version each stands for, and lists all ten with the data source', async () => {
    const view = await loadRulesView(admin(), {});
    expect(view.total).toBe(10);
    expect(view.counts).toEqual({ active: 4, draft: 6, pending: 0 });
    expect(view.rules.map((r) => r.code)).toEqual(['RULE-001', 'RULE-002', 'RULE-003', 'RULE-003A', 'RULE-004', 'RULE-005', 'RULE-006', 'RULE-007', 'RULE-008', 'RULE-009']);
    expect(view.sources).toEqual(['SYNTHETIC']);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it can cross to the client
  });

  it('gives a rule its current version: outcome, condition, status, effective date, and the source note', async () => {
    const view = await loadRulesView(admin(), {});
    const one = view.rules.find((r) => r.code === 'RULE-001');
    expect(one).toMatchObject({ name: 'Simple case: remote eligible', ruleStatus: 'active', next: null, working: null });
    expect(one?.current).toMatchObject({ version: 1, status: 'active', outcome: 'remote_eligible', effectiveFrom: '2026-08-01' });
    expect(one?.current.condition.predicates.length).toBeGreaterThan(1);
    expect(one?.sourceNote).toMatch(/Customer/);
    expect(view.rules.find((r) => r.code === 'RULE-003')).toMatchObject({ ruleStatus: 'draft', working: 1, next: null });
  });

  it('filters by search over code, name and condition, by status and by outcome', async () => {
    const c = admin();
    expect((await loadRulesView(c, { q: 'pedestrian involved' })).rules.map((r) => r.code)).toEqual(['RULE-004']);
    expect((await loadRulesView(c, { status: 'draft' })).rules).toHaveLength(6);
    expect((await loadRulesView(c, { status: 'active', outcome: 'remote_eligible' })).rules.map((r) => r.code)).toEqual(['RULE-001']);
    expect((await loadRulesView(c, { outcome: 'field_preferred' })).rules.map((r) => r.code)).toEqual(['RULE-003', 'RULE-006', 'RULE-009']);
    expect((await loadRulesView(c, { q: 'zzz' })).rules).toHaveLength(0);
    expect((await loadRulesView(c, { q: 'zzz' })).total).toBe(10);
  });

  it('lists the case types the "Case type" field offers', async () => {
    expect((await loadRulesView(admin(), {})).caseTypes).toEqual(['Standard case', 'Police attended', 'Unlisted']);
  });

  it('shows a rule with an active version and a waiting draft as active with "next v2"', async () => {
    const c = admin();
    await createRuleVersionDraft(c, 'RULE-001', { condition: { match: 'all', predicates: [{ field: 'injury_present', operator: 'eq', value: false }] }, condition_text_en: 'No injury', outcome: 'remote_eligible' });
    const row = (await loadRulesView(c, {})).rules.find((r) => r.code === 'RULE-001');
    expect(row).toMatchObject({ next: 2, working: 2 });
    expect(row?.current.status).toBe('active');
    expect((await loadRulesView(c, {})).counts.active).toBe(4);
  });

  it('shows a retired rule as retired', async () => {
    const c = admin();
    await retireRule(c, 'RULE-002', { note: null });
    expect((await loadRulesView(c, {})).rules.find((r) => r.code === 'RULE-002')?.current.status).toBe('retired');
  });
});

describe('loadRulesView: approvals and who may decide', () => {
  it('lists the rule approvals (not the roster or override ones) with the rule, version and the name of who decided', async () => {
    const view = await loadRulesView(admin(), {});
    expect(view.approvals).toHaveLength(4);
    expect(view.approvals.every((a) => a.status === 'approved' && a.denial === null)).toBe(true);
    expect(view.approvals[0]).toMatchObject({ version: 1, summary: expect.stringContaining('RULE-') });
    expect(view.pendingApprovals).toBe(0);
  });

  it('puts a submitted version first, pending, and tells the Administrator who submitted it that they cannot approve, and the Supervisor that they can', async () => {
    const c = admin();
    await submitRuleVersion(c, 'RULE-003', 1);
    const mine = await loadRulesView(c, {});
    expect(mine.pendingApprovals).toBe(1);
    expect(mine.counts.pending).toBe(1);
    expect(mine.approvals[0]).toMatchObject({ code: 'RULE-003', version: 1, status: 'pending', denial: 'own' });
    expect(mine.rules.find((r) => r.code === 'RULE-003')?.current.status).toBe('submitted');
    const theirs = await loadRulesView(supervisor(), {});
    expect(theirs.approvals[0]).toMatchObject({ code: 'RULE-003', status: 'pending', denial: null });
  });

  it('opens a rule on its working version with the denial of the person looking, and on ?version= when asked', async () => {
    const c = admin();
    await submitRuleVersion(c, 'RULE-003', 1);
    const asAdmin = await loadRulesView(c, { rule: 'RULE-003' });
    expect(asAdmin.open).toMatchObject({ shown: 1, denial: 'own' });
    expect((await loadRulesView(supervisor(), { rule: 'RULE-003' })).open?.denial).toBeNull();
    const active = await loadRulesView(c, { rule: 'RULE-001', version: 1 });
    expect(active.open).toMatchObject({ shown: 1, denial: null });
    expect(active.open?.history.map((h) => h.kind)).toEqual(['created', 'submitted', 'approved', 'effect']);
    expect((await loadRulesView(c, { rule: 'RULE-001', version: 9 })).open?.shown).toBe(1);
  });

  it('says an unknown code is unknown (a notice, never an error), and `new` is not a rule', async () => {
    const c = admin();
    expect(await loadRulesView(c, { rule: 'RULE-999' })).toMatchObject({ open: undefined, unknownRule: true });
    expect(await loadRulesView(c, { rule: 'new' })).toMatchObject({ open: undefined, unknownRule: false });
  });

  it('reads with the Dispatch Supervisor\'s view access, and refuses a role with none', async () => {
    expect((await loadRulesView(supervisor(), {})).total).toBe(10);
    await expect(loadRulesView(ctxOf('dispatcher'), {})).rejects.toMatchObject({ code: 'forbidden' });
    expect((await listRules(supervisor())).items).toHaveLength(10);
  });
});

describe('historyOf', () => {
  it('orders drafted, submitted, decided and effective events by time, with the note of a rejection', () => {
    const base = { outcome: 'field_mandatory', condition: { match: 'all', predicates: [] }, conditionText: 'x', effectiveFrom: null, effectiveTo: null, createdBy: 'Nadia', decidedBy: null } as const;
    const items = historyOf([
      { ...base, version: 1, status: 'rejected', createdAt: '2026-09-01T10:00:00+03:00', submittedAt: '2026-09-02T10:00:00+03:00', decidedAt: '2026-09-03T10:00:00+03:00', decidedBy: 'Fahad', note: 'Too broad' },
      { ...base, version: 2, status: 'draft', createdAt: '2026-09-04T10:00:00+03:00', submittedAt: null, decidedAt: null, note: null },
    ]);
    expect(items.map((i) => [i.version, i.kind])).toEqual([[1, 'created'], [1, 'submitted'], [1, 'rejected'], [2, 'created']]);
    expect(items[2]).toMatchObject({ name: 'Fahad', note: 'Too broad' });
  });
});
