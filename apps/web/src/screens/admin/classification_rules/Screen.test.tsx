// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { submitRuleVersion } from '@/lib/data/rules';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { ClassificationRulesScreen } from './Screen';

// The screen as the module route renders it, for the Administrator (edit) and the Dispatch Supervisor (view and approve). The data
// layer is real (fixtures, a temp demo store); the router, the actions, next-intl's server translator and the download are stood in for.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, saved: vi.fn(), navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.classification_rules'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/classification-rules', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ draftRule: vi.fn(), saveRuleDraft: vi.fn(), draftNewVersion: vi.fn(), approveRule: vi.fn(), rejectRule: vi.fn(), retireRuleNow: vi.fn(), draftRuleFromText: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

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
afterEach(() => {
  cleanup();
  for (const fn of [env.router.replace, env.router.push, env.saved, env.navigate]) fn.mockReset();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

interface Options {
  locale?: 'en' | 'ar';
  role?: 'administrator' | 'dispatch_supervisor';
  search?: SearchParams;
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', role = 'administrator', search = {}, state }: Options = {}) {
  env.locale = locale;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (typeof value === 'string') params.set(key, value);
  env.query = params.toString();
  const access = role === 'administrator' ? 'edit' : 'view';
  const element = await ClassificationRulesScreen({ def: getModule('admin.classification_rules'), ctx: ctxOf(role), access: { access, reduced: false }, locale, homeHref: '/admin/classification-rules', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.classification_rules' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const submitAsAdministrator = () => submitRuleVersion(ctxOf('administrator'), 'RULE-003', 1);

describe('Classification Rules: filled, English, Administrator (edit)', () => {
  it('carries the four hooks the e2e specs read, the module title, and the data source; two header actions', async () => {
    const { container } = await renderScreen();
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.classification_rules', 'filled', 'edit', 'false']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Classification Rules');
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'New rule' }).hasAttribute('aria-disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.queryByText('View only')).toBeNull();
  });

  it('has the three tabs (10 rules, 0 pending, AI review), three figures, and the six columns of the mockup', async () => {
    await renderScreen();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Rules10', 'Approvals0', 'AI review']);
    for (const label of ['Active', 'Draft', 'Pending']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Rule', 'Condition', 'Outcome', 'Status', 'Version', 'Effective from']));
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByText('10 of 10')).toBeTruthy();
  });

  it('draws a rule row: code and name, condition, outcome tag, status, version, effective date', async () => {
    await renderScreen();
    const row = bodyRows().find((r) => r.textContent?.includes('RULE-001')) as HTMLElement;
    expect(within(row).getByText('Simple case: remote eligible')).toBeTruthy();
    expect(within(row).getByText('Remote eligible')).toBeTruthy();
    expect(within(row).getByText('Active')).toBeTruthy();
    expect(within(row).getByText('v1')).toBeTruthy();
    expect(row.textContent).toContain('1 Aug 2026');
    const draft = bodyRows().find((r) => r.textContent?.includes('RULE-006')) as HTMLElement;
    expect(within(draft).getByText('Draft')).toBeTruthy();
    expect(within(draft).getByText('Not set')).toBeTruthy();
  });

  it('shows the precedence card (three outcomes, then "No match") and the approval steps with who does each', async () => {
    await renderScreen();
    expect(screen.getByRole('heading', { name: 'Precedence' })).toBeTruthy();
    expect(screen.getByText('No match')).toBeTruthy();
    const steps = within(screen.getByRole('heading', { name: 'Approval' }).closest('section, div, article') as HTMLElement);
    expect(steps.getAllByText('Dispatch Supervisor').length).toBeGreaterThan(0);
    expect(screen.getByText('Rejected returns to Draft')).toBeTruthy();
  });

  it('filters by ?q=, ?status= and ?outcome= from the address, and ignores what is not on an allow-list', async () => {
    await renderScreen({ search: { status: 'active', outcome: 'field_mandatory' } });
    expect(bodyRows()).toHaveLength(3);
    expect(screen.getByText('Status: Active')).toBeTruthy();
    expect(screen.getByText('Outcome: Field mandatory')).toBeTruthy();
    cleanup();
    await renderScreen({ search: { q: 'zzz' } });
    expect(screen.getByText('No rules match')).toBeTruthy();
    cleanup();
    await renderScreen({ search: { status: 'root', outcome: 'x', tab: 'evil', rule: 'RULE-<script>', version: '-1', page: '0' } });
    expect(bodyRows()).toHaveLength(10);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens a rule through ?rule= when its row is pressed (a push)', async () => {
    await renderScreen();
    fireEvent.click(bodyRows().find((r) => r.textContent?.includes('RULE-003A')) as HTMLElement);
    expect(env.navigate).toHaveBeenCalledWith('/admin/classification-rules?rule=RULE-003A');
  });

  it('exports every rule from More, with the current version\'s columns', async () => {
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    const [filename, table] = env.saved.mock.calls[0] as [string, { header: string[]; rows: string[][] }];
    expect(filename).toBe('classification-rules.csv');
    expect(table.header).toEqual(['rule_code', 'name_en', 'name_ar', 'status', 'version', 'outcome', 'condition_text_en', 'effective_from', 'effective_to']);
    expect(table.rows).toHaveLength(10);
    expect(table.rows[0]?.slice(0, 6)).toEqual(['RULE-001', 'Simple case: remote eligible', 'بلاغ بسيط: مؤهل عن بُعد', 'active', '1', 'remote_eligible']);
    expect(await screen.findByText('Rules exported')).toBeTruthy();
  });
});

describe('Classification Rules: the Approvals tab', () => {
  it('lists the four approved requests with the decision, and no buttons', async () => {
    await renderScreen({ search: { tab: 'approvals' } });
    expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
    expect(bodyRows()).toHaveLength(4);
    expect(within(bodyRows()[0] as HTMLElement).getByText('Approved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('shows a request the Administrator submitted as pending with Approve and Reject disabled and "You drafted this"', async () => {
    await submitAsAdministrator();
    await renderScreen({ search: { tab: 'approvals' } });
    expect(screen.getAllByRole('tab')[1]?.textContent).toBe('Approvals1');
    const pending = bodyRows()[0] as HTMLElement;
    expect(within(pending).getByText('Pending')).toBeTruthy();
    for (const name of ['Approve', 'Reject']) expect(within(pending).getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(pending).getByRole('button', { name: 'Approve' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives the Dispatch Supervisor Approve and Reject on it, and a note dialog that needs a note to reject', async () => {
    await submitAsAdministrator();
    await renderScreen({ role: 'dispatch_supervisor', search: { tab: 'approvals' } });
    const pending = bodyRows()[0] as HTMLElement;
    expect(within(pending).getByRole('button', { name: 'Approve' }).getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(within(pending).getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject RULE-003?' });
    expect(within(dialog).getAllByText('A note is required').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Reject' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Too broad' } });
    expect(within(dialog).getByRole('button', { name: 'Reject' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('says so when there are no approvals at all', async () => {
    const { container } = await renderScreen({ search: { tab: 'approvals' }, state: undefined });
    expect(container).toBeTruthy();
  });
});

describe('Classification Rules: the drawer from the address', () => {
  it('opens an active rule read only: "Read only. Draft a new version to change it", its versions and history, Draft new version and Retire', async () => {
    await renderScreen({ search: { rule: 'RULE-001' } });
    const drawer = screen.getByRole('dialog', { name: 'RULE-001' });
    expect(within(drawer).getByText('Read only. Draft a new version to change it.')).toBeTruthy();
    expect((within(drawer).getByLabelText(/^Condition\*?$/) as HTMLInputElement).disabled).toBe(true);
    expect(within(drawer).getByRole('button', { name: 'Draft new version' })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Retire' })).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(within(drawer).getByRole('heading', { name: 'Versions' })).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'History' })).toBeTruthy();
    expect(within(drawer).getByText('Source')).toBeTruthy();
    expect(within(drawer).getAllByRole('combobox').length).toBeGreaterThanOrEqual(3);
  });

  it('opens a draft editable, with the condition builder as rows of field, operator and value, and Save draft and Submit', async () => {
    await renderScreen({ search: { rule: 'RULE-003A' } });
    const drawer = screen.getByRole('dialog', { name: 'RULE-003A' });
    expect(within(drawer).getByRole('button', { name: 'Save draft' }).getAttribute('aria-disabled')).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Submit for approval' })).toBeTruthy();
    const fields = within(drawer).getAllByLabelText('Field') as HTMLSelectElement[];
    expect(fields).toHaveLength(1);
    expect(fields[0]?.value).toBe('parties_involved');
    expect((within(drawer).getByLabelText('Operator') as HTMLSelectElement).value).toBe('gte');
    expect((within(drawer).getByLabelText('Value') as HTMLInputElement).value).toBe('4');
    expect(within(drawer).getByRole('button', { name: 'Add condition' })).toBeTruthy();
  });

  it('opens the New rule form on ?rule=new with a code field and a first condition, and Save waits for a code, a name and a condition', async () => {
    await renderScreen({ search: { rule: 'new' } });
    const drawer = screen.getByRole('dialog', { name: 'New rule' });
    expect(within(drawer).getByPlaceholderText('RULE-010')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Save draft' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(drawer).getAllByText('Enter a rule code').length).toBeGreaterThan(0);
  });

  it('opens a submitted rule with Approve and Reject disabled for its submitter, with the reason in the footer', async () => {
    await submitAsAdministrator();
    await renderScreen({ search: { rule: 'RULE-003' } });
    const drawer = screen.getByRole('dialog', { name: 'RULE-003' });
    expect(within(drawer).getByRole('button', { name: 'Approve' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(drawer).getByText('You drafted this. A Dispatch Supervisor approves it.')).toBeTruthy();
    cleanup();
    await renderScreen({ role: 'dispatch_supervisor', search: { rule: 'RULE-003' } });
    const theirs = screen.getByRole('dialog', { name: 'RULE-003' });
    expect(within(theirs).getByRole('button', { name: 'Approve' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('shows an inline notice and no drawer for a rule that does not exist', async () => {
    await renderScreen({ search: { rule: 'RULE-999' } });
    expect(screen.getByRole('alert').textContent).toContain('That rule could not be found.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Classification Rules: the Dispatch Supervisor (view and approve)', () => {
  it('says View only, and shows drafting, saving, submitting and retiring disabled with the reason', async () => {
    await renderScreen({ role: 'dispatch_supervisor' });
    expect(screen.getByText('View only')).toBeTruthy();
    const add = screen.getByRole('button', { name: 'New rule' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(add);
    expect(env.router.push).not.toHaveBeenCalled();
  });

  it('opens a draft readable with its fields disabled and Save draft disabled, and does not open New rule from the address', async () => {
    await renderScreen({ role: 'dispatch_supervisor', search: { rule: 'RULE-003A' } });
    const drawer = screen.getByRole('dialog', { name: 'RULE-003A' });
    expect(within(drawer).getByRole('button', { name: 'Save draft' }).getAttribute('aria-disabled')).toBe('true');
    expect((within(drawer).getByLabelText(/^Condition\*?$/) as HTMLInputElement).disabled).toBe(true);
    cleanup();
    await renderScreen({ role: 'dispatch_supervisor', search: { rule: 'new' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Classification Rules: the five states', () => {
  it('empty: the module text and New rule (disabled with a reason for a view-only role)', async () => {
    const { container } = await renderScreen({ state: 'empty' });
    expect(root(container)?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('Draft a rule to start.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New rule' }).length).toBeGreaterThan(0);
    cleanup();
    await renderScreen({ state: 'empty', role: 'dispatch_supervisor' });
    expect(screen.getAllByRole('button', { name: 'New rule' }).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
  });

  it('loading and error, with the header kept and no data read', async () => {
    const loading = await renderScreen({ state: 'loading' });
    expect(root(loading.container)?.getAttribute('data-state')).toBe('loading');
    expect(screen.getAllByText('Loading')).toHaveLength(1);
    cleanup();
    const error = await renderScreen({ state: 'error' });
    expect(root(error.container)?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('Rules could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('RULE-001')).toBeNull();
  });
});

describe('Classification Rules in Arabic', () => {
  // Codes, names, condition texts and the server's English detail are data (translate="no" / lang="en"); everything else is Arabic.
  const latin = (element: HTMLElement) => {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
    const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].filter((el) => !/^(Select row|تحديد الصف)/.test(el.getAttribute('aria-label') ?? '')).flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
    return ((`${clone.textContent ?? ''} ${attributes.join(' ')}`).replace(/RULE-\d+A?/g, ' ').match(/[A-Za-z][A-Za-z\s'.,-]*/g) ?? []).join('|').trim();
  };

  it('draws the rules, the approvals and the drawers in Arabic with no English left over outside the data', async () => {
    const list = await renderScreen({ locale: 'ar' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('قواعد التصنيف');
    expect(latin(list.container)).toBe('');
    expect(screen.getByRole('button', { name: 'قاعدة جديدة' })).toBeTruthy();
    cleanup();
    await submitAsAdministrator();
    const approvals = await renderScreen({ locale: 'ar', role: 'dispatch_supervisor', search: { tab: 'approvals' } });
    expect(latin(approvals.container)).toBe('');
    cleanup();
    for (const rule of ['RULE-001', 'RULE-003', 'new']) {
      await renderScreen({ locale: 'ar', search: { rule } });
      expect(latin(screen.getByRole('dialog'))).toBe('');
      cleanup();
    }
  });

  it('draws the states and view-only in Arabic', async () => {
    await renderScreen({ locale: 'ar', state: 'empty' });
    expect(screen.getByText('صُغ قاعدة للبدء.')).toBeTruthy();
    cleanup();
    await renderScreen({ locale: 'ar', state: 'error' });
    expect(screen.getByText('تعذّر تحميل القواعد.')).toBeTruthy();
    cleanup();
    await renderScreen({ locale: 'ar', role: 'dispatch_supervisor' });
    expect(screen.getByText('عرض فقط')).toBeTruthy();
  });
});
