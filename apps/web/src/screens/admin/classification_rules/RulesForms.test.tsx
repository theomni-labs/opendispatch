// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import type { ActionResult } from '@/lib/actions/types';
import { RuleDrawer } from './RulesForms';
import type { OpenRule, VersionRow } from './types';

// The rule drawer with the actions and the router stood in for. What each test checks is what the browser sends to an action and what the person sees for each answer.
const env = vi.hoisted(() => ({
  query: '',
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  actions: { draftRule: vi.fn(), saveRuleDraft: vi.fn(), draftNewVersion: vi.fn(), approveRule: vi.fn(), rejectRule: vi.fn(), retireRuleNow: vi.fn() },
}));

vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/classification-rules', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => env.actions);

beforeEach(() => {
  env.query = '';
  for (const fn of [env.router.push, env.router.replace, ...Object.values(env.actions)]) fn.mockReset();
});
afterEach(cleanup);

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (code: 'forbidden' | 'conflict' | 'invalid', message: string): ActionResult<never> => ({ ok: false, code, message });

const version = (overrides: Partial<VersionRow> = {}): VersionRow => ({
  version: 1,
  status: 'draft',
  outcome: 'field_mandatory',
  condition: { match: 'all', predicates: [{ field: 'parties_involved', operator: 'gte', value: 4 }] },
  conditionText: 'Four or more parties',
  effectiveFrom: null,
  effectiveTo: null,
  createdAt: '2026-09-01T10:00:00+03:00',
  createdBy: 'Nadia Al-Ghalani',
  submittedAt: null,
  decidedAt: null,
  decidedBy: null,
  note: null,
  ...overrides,
});
const open = (v: VersionRow, overrides: Partial<OpenRule['rule']> = {}, denial: OpenRule['denial'] = null): OpenRule => ({
  rule: { code: 'RULE-003A', name: 'Four or more parties', nameAr: null, sourceNote: null, ruleStatus: v.status === 'active' ? 'active' : 'draft', current: v, next: null, working: v.status === 'draft' || v.status === 'submitted' ? v.version : null, ...overrides },
  versions: [v],
  shown: v.version,
  history: [{ id: '1:created', kind: 'created', version: 1, at: v.createdAt, name: 'Nadia Al-Ghalani', note: null }],
  denial,
});

const inShell = (locale: 'en' | 'ar', ui: React.ReactNode) => inLocale(locale, <DesignSystemProvider navigate={vi.fn()}>{ui}</DesignSystemProvider>, { module: 'admin.classification_rules' });
const drawer = (props: Partial<Parameters<typeof RuleDrawer>[0]> = {}) => <RuleDrawer open={open(version())} isNew={false} canEdit caseTypes={['Standard case', 'Unlisted']} {...props} />;
const press = async (name: string | RegExp, within_?: HTMLElement) => {
  await act(async () => {
    fireEvent.click((within_ === undefined ? screen : within(within_)).getByRole('button', { name }));
  });
};

describe('a draft version', () => {
  it('saves what the person changed as a draft: the condition as rows, the text, the outcome and the dates, and nothing about who they are', async () => {
    env.actions.saveRuleDraft.mockResolvedValue(ok({ code: 'RULE-003A', version: 1, submitted: false }));
    inShell('en', drawer());
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/^Condition\*?$/), { target: { value: 'Five or more parties' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Field preferred' }));
    fireEvent.change(screen.getAllByLabelText(/^Effective from/)[0] as HTMLElement, { target: { value: '2026-10-01' } });
    await press('Save draft');
    expect(env.actions.saveRuleDraft).toHaveBeenCalledWith({
      rule_code: 'RULE-003A',
      version: 1,
      submit: false,
      match: 'all',
      predicates: [{ field: 'parties_involved', operator: 'gte', value: 5 }],
      condition_text_en: 'Five or more parties',
      outcome: 'field_preferred',
      effective_from: '2026-10-01',
      effective_to: '',
    });
    expect(await screen.findByText('Draft saved')).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalledWith('/admin/classification-rules', { scroll: false });
  });

  it('submits for approval in the same call, and says who approves', async () => {
    env.actions.saveRuleDraft.mockResolvedValue(ok({ code: 'RULE-003A', version: 1, submitted: true }));
    inShell('en', drawer());
    await press('Submit for approval');
    expect(env.actions.saveRuleDraft).toHaveBeenCalledWith(expect.objectContaining({ submit: true }));
    expect(await screen.findByText('Submitted for approval')).toBeTruthy();
    expect(screen.getByText('A Dispatch Supervisor approves it')).toBeTruthy();
  });

  it('builds a condition from rows: adds one, removes one, changes a field and its value resets to the field\'s kind', async () => {
    inShell('en', drawer());
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(screen.getAllByLabelText('Field')).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText('Field')[1] as HTMLElement, { target: { value: 'injury_present' } });
    expect((screen.getAllByLabelText('Value')[1] as HTMLSelectElement).value).toBe('true');
    fireEvent.change(screen.getAllByLabelText('Field')[1] as HTMLElement, { target: { value: 'case_type' } });
    expect((screen.getAllByLabelText('Value')[1] as HTMLSelectElement).value).toBe('Standard case');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove condition' })[0] as HTMLElement);
    expect(screen.getAllByLabelText('Field')).toHaveLength(1);
    expect((screen.getByLabelText('Field') as HTMLSelectElement).value).toBe('case_type');
  });

  it('shows a case type by its display name and saves its code', async () => {
    env.actions.saveRuleDraft.mockResolvedValue(ok({ code: 'RULE-003A', version: 1, submitted: false }));
    const byType = version({ condition: { match: 'all', predicates: [{ field: 'case_type', operator: 'eq', value: 'Unlisted' }] } });
    inShell('en', drawer({ open: open(byType), caseTypeLabels: { 'Standard case': 'Standard case', Unlisted: 'Non-standard case' } }));
    const value = screen.getByLabelText('Value') as HTMLSelectElement;
    expect(value.value).toBe('Unlisted');
    expect([...value.options].map((o) => o.textContent)).toEqual(['Standard case', 'Non-standard case']);
    await press('Save draft');
    expect(env.actions.saveRuleDraft).toHaveBeenCalledWith(expect.objectContaining({ predicates: [{ field: 'case_type', operator: 'eq', value: 'Unlisted' }] }));
  });

  it('keeps Save unavailable, with the reason, while a row is incomplete or the text is empty', async () => {
    inShell('en', drawer());
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Save draft' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Complete every condition').length).toBeGreaterThan(0);
    await press('Save draft');
    expect(env.actions.saveRuleDraft).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/^Condition\*?$/), { target: { value: ' ' } });
    expect(screen.getAllByText('Enter a name and a condition').length).toBeGreaterThan(0);
  });

  it('shows the data layer\'s English refusal in the drawer and keeps what the person typed', async () => {
    env.actions.saveRuleDraft.mockResolvedValue(fail('conflict', 'Only drafts can be changed.'));
    inShell('en', drawer());
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '9' } });
    await press('Save draft');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Only drafts can be changed.');
    expect(alert.querySelector('[lang="en"]')).not.toBeNull();
    expect((screen.getByLabelText('Value') as HTMLInputElement).value).toBe('9');
    expect(env.router.replace).not.toHaveBeenCalled();
  });

  it('keeps a rule that tests a field the list does not have, and the kind of its value', async () => {
    env.actions.saveRuleDraft.mockResolvedValue(ok({ code: 'RULE-003A', version: 1, submitted: false }));
    const odd = version({ condition: { match: 'any', predicates: [{ field: 'road_speed', operator: 'gt', value: 90 }, { field: 'weather_clear', operator: 'eq', value: true }] } });
    inShell('en', drawer({ open: open(odd) }));
    expect((screen.getAllByLabelText('Field')[0] as HTMLSelectElement).value).toBe('road_speed');
    await press('Save draft');
    expect(env.actions.saveRuleDraft).toHaveBeenCalledWith(expect.objectContaining({ match: 'any', predicates: [{ field: 'road_speed', operator: 'gt', value: 90 }, { field: 'weather_clear', operator: 'eq', value: true }] }));
  });
});

describe('a new rule', () => {
  it('asks for a code, a name and a condition, and drafts the rule with its first version', async () => {
    env.actions.draftRule.mockResolvedValue(ok({ code: 'RULE-010', version: 1, created: true, submitted: false }));
    inShell('en', drawer({ open: undefined, isNew: true }));
    expect(screen.getByRole('button', { name: 'Save draft' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByPlaceholderText('RULE-010'), { target: { value: 'RULE-010' } });
    fireEvent.change(screen.getByLabelText(/^Name \(English\)/), { target: { value: 'Ten' } });
    fireEvent.change(screen.getByLabelText(/^Condition\*?$/), { target: { value: 'Three parties' } });
    await press('Save draft');
    expect(env.actions.draftRule).toHaveBeenCalledWith(expect.objectContaining({ rule_code: 'RULE-010', name_en: 'Ten', name_ar: '', submit: false, predicates: [{ field: 'parties_involved', operator: 'eq', value: 3 }] }));
    expect(await screen.findByText('Rule drafted')).toBeTruthy();
  });
});

describe('an active version', () => {
  const active = version({ status: 'active', effectiveFrom: '2026-08-01' });

  it('drafts the next version, and shows it', async () => {
    env.actions.draftNewVersion.mockResolvedValue(ok({ code: 'RULE-003A', version: 2 }));
    inShell('en', drawer({ open: open(active) }));
    await press('Draft new version');
    expect(env.actions.draftNewVersion).toHaveBeenCalledWith({ rule_code: 'RULE-003A', version: 1 });
    expect(await screen.findByText('Version drafted')).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalledWith('/admin/classification-rules?version=2', { scroll: false });
  });

  it('does not offer a second draft while one waits, and retires only after a confirmation', async () => {
    env.actions.retireRuleNow.mockResolvedValue(ok({ code: 'RULE-003A', version: 0 }));
    inShell('en', drawer({ open: open(active, { working: 2, next: 2 }) }));
    expect(screen.queryByRole('button', { name: 'Draft new version' })).toBeNull();
    await press('Retire');
    const confirm = screen.getByRole('dialog', { name: 'Retire RULE-003A?' });
    await press('Retire', confirm);
    expect(env.actions.retireRuleNow).toHaveBeenCalledWith({ rule_code: 'RULE-003A', note: '' });
    expect(await screen.findByText('Rule retired')).toBeTruthy();
  });
});

describe('a submitted version and a rejected one', () => {
  const submitted = version({ status: 'submitted', submittedAt: '2026-09-02T10:00:00+03:00' });

  it('approves with a note that is optional, and says when it takes effect', async () => {
    env.actions.approveRule.mockResolvedValue(ok({ code: 'RULE-003A', version: 1, effectiveFrom: '2026-09-20' }));
    inShell('en', drawer({ open: open(submitted) }));
    await press('Approve');
    const dialog = screen.getByRole('dialog', { name: 'Approve RULE-003A?' });
    await press('Approve', dialog);
    expect(env.actions.approveRule).toHaveBeenCalledWith({ rule_code: 'RULE-003A', version: 1, note: '' });
    expect(await screen.findByText('RULE-003A takes effect 20 Sept 2026')).toBeTruthy();
  });

  it('needs a note to reject, and sends it', async () => {
    env.actions.rejectRule.mockResolvedValue(ok({ code: 'RULE-003A', version: 1 }));
    inShell('en', drawer({ open: open(submitted) }));
    await press('Reject');
    const dialog = screen.getByRole('dialog', { name: 'Reject RULE-003A?' });
    expect(within(dialog).getByRole('button', { name: 'Reject' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Too broad' } });
    await press('Reject', dialog);
    expect(env.actions.rejectRule).toHaveBeenCalledWith({ rule_code: 'RULE-003A', version: 1, note: 'Too broad' });
    expect(await screen.findByText('Rule rejected')).toBeTruthy();
  });

  it('keeps Approve and Reject disabled with the reason for the person who submitted it or a role that cannot approve, and never opens the dialog', async () => {
    inShell('en', drawer({ open: open(submitted, {}, 'own') }));
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(approve);
    expect(screen.queryByRole('dialog', { name: 'Approve RULE-003A?' })).toBeNull();
    expect(screen.getAllByText('You drafted this. A Dispatch Supervisor approves it.').length).toBeGreaterThan(0);
    cleanup();
    inShell('en', drawer({ open: open(submitted, {}, 'role') }));
    expect(screen.getAllByText('Only a Dispatch Supervisor can approve').length).toBeGreaterThan(0);
  });

  it('revises a rejected version as a new draft, unless one waits already', async () => {
    env.actions.draftNewVersion.mockResolvedValue(ok({ code: 'RULE-003A', version: 2 }));
    const rejected = version({ status: 'rejected', decidedAt: '2026-09-03T10:00:00+03:00', decidedBy: 'Fahad Al-Musari', note: 'Too broad' });
    inShell('en', drawer({ open: open(rejected, { working: null }) }));
    await press('Revise as draft');
    expect(env.actions.draftNewVersion).toHaveBeenCalledWith({ rule_code: 'RULE-003A', version: 1 });
    await waitFor(() => expect(env.router.replace).toHaveBeenCalled());
    cleanup();
    inShell('en', drawer({ open: open(rejected, { working: 2 }) }));
    expect(screen.queryByRole('button', { name: 'Revise as draft' })).toBeNull();
  });
});

describe('in Arabic', () => {
  it('draws the drawer and the builder with Arabic labels, the code and the values left to right', () => {
    inShell('ar', drawer());
    expect(screen.getByRole('dialog', { name: 'RULE-003A' })).toBeTruthy();
    expect(screen.getAllByLabelText('الحقل')).toHaveLength(1);
    expect((screen.getByLabelText('القيمة') as HTMLInputElement).getAttribute('dir')).toBe('ltr');
    expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'إضافة شرط' })).toBeTruthy();
  });
});
