// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// loadImportView reads Go: the screen needs it.
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { compareImport, dryRunCutover, listDataQualityIssues, listImportJobs, uploadImport, validateImport } from '@/lib/data/imports';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { createTranslator } from 'next-intl';
import { loadMessages } from '@/i18n/messages';
import * as client from '@/lib/data/import-upload-client';
import * as actions from './actions';
import { issueLine, issueText, type IssueText } from './issueMessage';
import type { StepView } from './importSteps';
import { DataImportQualityScreen } from './Screen';

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the
// element it returns is rendered in each language. The router, the actions and next-intl's server translator are stood in for.
// Every call an action gets is checked to carry only what a person chose.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, saved: vi.fn(), navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.data_import_quality'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/data-import-quality', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ startStep: vi.fn(), stepProgress: vi.fn(), startUpload: vi.fn(), finishUpload: vi.fn(), cancelUpload: vi.fn(), uploadImportFile: vi.fn(), validateJob: vi.fn(), compareJob: vi.fn(), dryRunJob: vi.fn(), cutOverJob: vi.fn(), rollBackJob: vi.fn(), setIssueStatus: vi.fn(), suggestMapping: vi.fn(), explainIssues: vi.fn(), saveMapping: vi.fn() }));
vi.mock('@/lib/data/import-upload-client', () => ({ sendImportUploadChunk: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

afterEach(() => {
  cleanup();
  for (const mock of [...Object.values(actions), client.sendImportUploadChunk]) if (vi.isMockFunction(mock)) mock.mockReset();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.saved, env.navigate]) mock.mockReset();
});

function ctxOf(role: Role = 'administrator', installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

interface Options {
  locale?: 'en' | 'ar';
  access?: 'edit' | 'view';
  search?: SearchParams;
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', access = 'edit', search = {}, state }: Options = {}) {
  env.locale = locale;
  env.query = new URLSearchParams(Object.entries(search).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : []))).toString();
  const element = await DataImportQualityScreen({ def: getModule('admin.data_import_quality'), ctx: ctxOf(), access: { access, reduced: false }, locale, homeHref: '/admin/data-import-quality', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.data_import_quality' });
}

const ok = <T,>(data: T) => ({ ok: true as const, data });
const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const disabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true';
// A button that is neither disabled nor busy (a click on a loading button is ignored, and a transition ends a tick after its result shows).
const idle = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true' && el.getAttribute('aria-busy') !== 'true';
const mockOf = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn);
// A step as the api reports it, polled.
type Outcome = NonNullable<StepView['outcome']>;
const stepView = (jobId: string, step: StepView['step'], state: StepView['state'], status: StepView['status'], outcome: Outcome | null = null): StepView => ({ jobId, step, state, done: 3, total: 4, error: null, status, outcome });
const SLOW = { timeout: 6000 };
// Starts running, then the poll says it ended.
function stepRuns(jobId: string, step: StepView['step'], before: StepView['status'], after: StepView['status'], outcome: Outcome | null) {
  mockOf(actions.startStep).mockResolvedValue(ok(stepView(jobId, step, 'running', before)));
  mockOf(actions.stepProgress).mockResolvedValue(ok(stepView(jobId, step, 'succeeded', after, outcome)));
}
const FORBIDDEN = /"(role|customer|tenant|user|userId|installMode|install_mode|zoneScope|ctx)"/;
const dataText = (container: HTMLElement) => {
  const copy = container.cloneNode(true) as HTMLElement;
  for (const node of copy.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
  // "CSV" is a file format, written the same in both languages.
  return (copy.textContent ?? '').replaceAll('CSV', '');
};
const jobs = async () => (await listImportJobs(ctxOf(), { limit: 10 })).items;
const partial = async () => (await jobs()).find((j) => j.file_name.includes('partial')) as Awaited<ReturnType<typeof jobs>>[number];
const fileOf = (name: string, text: string) => Object.assign(new File([text], name), { text: async () => text });
const drop = (container: HTMLElement, file: File) => fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });

// A real, valid row: real disposable uploads need every required mapping column, not just RecordID/CaseNumber.
const VALID_ROW =
  'RecordID,CaseNumber,RegisteredTime,CityID,CityNameEn,ZoneID,ZoneNameEn,SubZoneID,SubZoneNameEn,Latitude,Longitude,CaseTypeID,CaseTypeNameEn,PartyCount,AssignedTime,ArrivalTime,ClosingTime\n' +
  '9300001,RD-260920-9300001,2026-09-20 08:00:00,101,Riyadh,2001,Riyadh Central,30001,Juniper Square,24.71,46.68,1,Standard case,2,,,';

describe.skipIf(!hasApi)('Data Import and Quality Screen (live, real api and Postgres)', () => {
  describe('filled, English, Administrator (edit)', () => {
    it('carries the four hooks the e2e specs read, the module title and the data source, with no Demo tag (the import path is real)', async () => {
      const { container } = await renderScreen();
      const page = root(container);
      expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.data_import_quality', 'filled', 'edit', 'false']);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Data Import and Quality');
      expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
      expect(container.querySelector('[data-stub="demo"]')).toBeNull();
      expect(screen.queryByText('View only')).toBeNull();
    });

    it('has two header actions (Upload file, More), three tabs with their counts, and four figures', async () => {
      await renderScreen();
      expect(disabled(screen.getByRole('button', { name: 'Upload file' }))).toBe(false);
      expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
      expect(screen.getAllByRole('tab').length).toBe(3);
      for (const label of ['Rows in file', 'Errors', 'Warnings', 'Cases held']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    });

    it('shows the newest job on the Import tab with its five steps, its findings, Compare as the next step, and the mapping', async () => {
      const job = (await jobs())[0];
      const { container } = await renderScreen();
      expect(screen.getByRole('heading', { name: job?.file_name ?? '' })).toBeTruthy();
      expect(screen.getByText('Validated')).toBeTruthy();
      const steps = container.querySelectorAll('ol li');
      expect([...steps].map((s) => s.textContent?.replace(/\s*\(completed\)$/, '').replace(/^\d/, ''))).toEqual(['Upload', 'Validate', 'Compare', 'Dry run', 'Cut over']);
      expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Compare');
      expect(container.textContent).toContain('Error');
      expect(disabled(screen.getByRole('button', { name: 'Compare' }))).toBe(false);
      expect(screen.getByRole('button', { name: 'View issues' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Mapping' })).toBeTruthy();
      expect(within(screen.getByRole('heading', { name: 'Mapping' }).closest('div') as HTMLElement).getByText('Draft')).toBeTruthy();
      expect(container.textContent).toContain('Customer case extract v1');
      expect(container.textContent).toContain('Asia/Riyadh');
    });

    it('draws the drop area for CSV only with the honest size limit in the hint', async () => {
      const { container } = await renderScreen();
      const input = container.querySelector('input[type="file"]');
      expect(input?.getAttribute('accept')).toBe('.csv');
      expect(container.textContent).toContain('CSV only, up to 1 GB');
    });

    it('?job= shows another job (the failed one shows its alert, the cut-over one Done disabled), and an unknown job shows the newest with a notice', async () => {
      const failed = (await jobs()).find((j) => j.status === 'failed');
      await renderScreen({ search: { job: failed?.id } });
      expect(screen.getByText('Header not read')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Upload again' })).toBeTruthy();
      cleanup();
      const cut = (await jobs()).find((j) => j.status === 'cut_over');
      await renderScreen({ search: { job: cut?.id } });
      expect(screen.getAllByText('Cut over').length).toBeGreaterThan(0);
      expect(disabled(screen.getByRole('button', { name: 'Done' }))).toBe(true);
      expect(disabled(screen.getByRole('button', { name: 'Roll back' }))).toBe(false);
      cleanup();
      await renderScreen({ search: { job: '00000000-0000-4000-8000-000000000001' } });
      expect(screen.getByText('That import could not be found.')).toBeTruthy();
    });

    it('the Jobs tab lists the imports with status, rows, errors and warnings; a row opens that job on the Import tab', async () => {
      await renderScreen({ search: { tab: 'jobs' } });
      const table = screen.getByRole('table', { name: 'Jobs' });
      expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['File', 'Status', 'Rows', 'Errors', 'Warnings', 'Validated', 'Cut over']));
      const rows = within(table).getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length > 0);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const failedRow = rows.find((r) => r.textContent?.includes('bad_header')) as HTMLElement;
      fireEvent.click(failedRow);
      expect(env.navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/data-import-quality\?job=[0-9a-f-]{36}$/));
    });
  });

  describe('the Issues tab and its drawer', () => {
    it('lists the issues with the six columns, coloured rows by severity, the total and the filter chips', async () => {
      await renderScreen({ search: { tab: 'issues' } });
      const table = screen.getByRole('table', { name: 'Issues' });
      expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Severity', 'Issue', 'Row', 'Field', 'Status', 'Job']));
      expect(within(table).getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length > 0).length).toBeGreaterThan(0);
      expect(screen.getByRole('searchbox')).toBeTruthy();
      for (const chip of ['Severity', 'Status', 'Issue']) expect(screen.getAllByText(chip).length).toBeGreaterThan(0);
    });

    it('?severity= ?status= ?type= and ?q= narrow the list on the server; a value that is not on the list is ignored', async () => {
      const total = (await listDataQualityIssues(ctxOf(), { limit: 200 })).items.length;
      await renderScreen({ search: { tab: 'issues', severity: 'error' } });
      const errors = (await listDataQualityIssues(ctxOf(), { severity: 'error', limit: 200 })).items.length;
      expect(screen.getByText(new RegExp(`^${errors} of ${total} shown$`))).toBeTruthy();
      cleanup();
      await renderScreen({ search: { tab: 'issues', severity: 'root', status: 'everything' } });
      expect(screen.getByText(new RegExp(`of ${total} shown$`)).textContent).toMatch(/^\d+ of \d+/);
      cleanup();
      await renderScreen({ search: { tab: 'issues', q: 'zzz-no-such-issue' } });
      expect(screen.getByText('No match')).toBeTruthy();
    });

    it('a row opens its issue: the address gets ?issue=<id> (not ?id=), keeping the tab and the filters', async () => {
      await renderScreen({ search: { tab: 'issues', severity: 'error' } });
      const table = screen.getByRole('table', { name: 'Issues' });
      fireEvent.click(within(table).getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length > 0)[0] as HTMLElement);
      expect(env.navigate).toHaveBeenCalledTimes(1);
      const opened = env.navigate.mock.calls[0]?.[0] as string;
      expect(opened).toMatch(/^\/admin\/data-import-quality\?/);
      const params = new URL(opened, 'http://x').searchParams;
      expect(params.get('issue')).toMatch(/^[0-9a-f-]{36}$/);
      expect(params.get('id')).toBeNull();
      expect([params.get('tab'), params.get('severity')]).toEqual(['issues', 'error']);
    });

    it('?job= narrows the list to that import\'s issues (the Import tab\'s "View issues" sets it) and shows it as a chip; a job that is not there filters nothing', async () => {
      const job = await partial();
      const total = (await listDataQualityIssues(ctxOf(), { limit: 200 })).items.length;
      const own = (await listDataQualityIssues(ctxOf(), { import_job_id: job.id, limit: 200 })).items.length;
      expect(own).toBeGreaterThan(0);
      expect(own).toBeLessThan(total);
      await renderScreen({ search: { tab: 'issues', job: job.id } });
      expect(screen.getByText(`${own} of ${total} shown`)).toBeTruthy();
      expect(screen.getAllByText(new RegExp(`Job: ${job.file_name}`)).length).toBeGreaterThan(0);
      cleanup();
      await renderScreen({ search: { tab: 'issues', job: '00000000-0000-4000-8000-000000000001' } });
      expect(screen.getByText(`${total} of ${total} shown`)).toBeTruthy();
    });

    it('?issue= opens the drawer: the type, severity, message, field, row, status choices, an optional note and Save', async () => {
      const issue = (await listDataQualityIssues(ctxOf(), { severity: 'error', limit: 5 })).items[0];
      await renderScreen({ search: { tab: 'issues', issue: issue?.id } });
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Open', 'Acknowledged', 'Resolved', 'Ignored']);
      expect(within(dialog).getByText('Message')).toBeTruthy();
      expect(within(dialog).getByRole('textbox')).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy();
      // A known line is translated, not marked English
      const known = issueText(issue?.message as string, issue?.field ?? null);
      expect(known).not.toBeNull();
      const m = createTranslator({ locale: 'en', messages: loadMessages('en', 'admin.data_import_quality'), namespace: 'admin.data_import_quality' });
      expect(dialog.textContent).toContain(issueLine((key, values) => m(key as never, values as never), known as IssueText));
      expect([...dialog.querySelectorAll('[lang="en"]')].some((el) => el.textContent === issue?.message)).toBe(false);
    });

    it('Escape closes the issue drawer by removing ?issue= (and only that) from the address, so the same row can be opened again', async () => {
      const issue = (await listDataQualityIssues(ctxOf(), { severity: 'error', limit: 5 })).items[0];
      await renderScreen({ search: { tab: 'issues', severity: 'error', issue: issue?.id } });
      fireEvent.keyDown(within(screen.getByRole('dialog')).getByRole('textbox'), { key: 'Escape' });
      await waitFor(() => expect(env.router.replace).toHaveBeenCalled());
      const closed = env.router.replace.mock.calls[0]?.[0] as string;
      const params = new URL(closed, 'http://x').searchParams;
      expect(params.get('issue')).toBeNull();
      expect([params.get('tab'), params.get('severity')]).toEqual(['issues', 'error']);
    });

    it('Save sends the issue id, the chosen status and the note, and nothing else', async () => {
      mockOf(actions.setIssueStatus).mockResolvedValue(ok({ issueId: 'x', status: 'ignored' as const, type: 'missing_required_field' as const }));
      const issue = (await listDataQualityIssues(ctxOf(), { severity: 'error', limit: 5 })).items[0];
      await renderScreen({ search: { tab: 'issues', issue: issue?.id } });
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Ignored' }));
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Known bad row' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(actions.setIssueStatus).toHaveBeenCalledWith({ issueId: issue?.id, status: 'ignored', note: 'Known bad row' }));
      expect(JSON.stringify(mockOf(actions.setIssueStatus).mock.calls)).not.toMatch(FORBIDDEN);
      expect(await screen.findByText('Issue set to Ignored')).toBeTruthy();
    });

    it('an unknown or malformed ?issue= shows the list with a notice, never an error', async () => {
      await renderScreen({ search: { tab: 'issues', issue: '00000000-0000-4000-8000-000000000001' } });
      expect(screen.getByText('That issue could not be found.')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      cleanup();
      await renderScreen({ search: { tab: 'issues', issue: 'not-an-id' } });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('table', { name: 'Issues' })).toBeTruthy();
    });
  });

  describe('what the controls send', () => {
    const CSV = 'RecordID,CaseNumber\n1,RD-1\n';
    const started = (chunkCount: number) => ok({ uploadId: 'up-1', chunkSize: 8, chunkCount, received: [] });

    it('a CSV file goes in parts: started with its name, size, mapping and source, each part sent once in order, then finished', async () => {
      mockOf(actions.startUpload).mockResolvedValue(started(4));
      mockOf(client.sendImportUploadChunk).mockResolvedValue(ok({ received: [] }));
      mockOf(actions.finishUpload).mockResolvedValue(ok({ jobId: 'j', file: 'cases.csv', rows: 2 }));
      const { container } = await renderScreen();
      drop(container, fileOf('cases.csv', CSV));
      await waitFor(() => expect(actions.finishUpload).toHaveBeenCalledWith({ uploadId: 'up-1' }));
      expect(actions.startUpload).toHaveBeenCalledWith({ file_name: 'cases.csv', size: CSV.length, mapping_version: 'generic_csv_v1', data_source: 'SYNTHETIC' });
      expect(mockOf(client.sendImportUploadChunk).mock.calls.map((c) => [c[0], c[1], (c[2] as Blob).size])).toEqual([['up-1', 0, 8], ['up-1', 1, 8], ['up-1', 2, 8], ['up-1', 3, 5]]);
      expect(await screen.findByText('File uploaded')).toBeTruthy();
      expect(env.router.replace).toHaveBeenCalledWith(expect.stringContaining('job=j'), expect.anything());
      expect(JSON.stringify([mockOf(actions.startUpload).mock.calls, mockOf(actions.finishUpload).mock.calls])).not.toMatch(FORBIDDEN);
    });

    it('shows a progress bar while the parts go, and Cancel removes the upload', async () => {
      mockOf(actions.startUpload).mockResolvedValue(started(4));
      mockOf(actions.cancelUpload).mockResolvedValue(ok(null));
      let release: () => void = () => undefined;
      mockOf(client.sendImportUploadChunk).mockImplementationOnce(async () => ok({ received: [0] })).mockImplementation(() => new Promise((resolve) => (release = () => resolve(ok({ received: [] })))));
      const { container } = await renderScreen();
      drop(container, fileOf('cases.csv', CSV));
      const bar = await screen.findByRole('progressbar');
      await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('8'));
      expect(bar.getAttribute('aria-valuemax')).toBe(String(CSV.length));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(actions.cancelUpload).toHaveBeenCalledWith({ uploadId: 'up-1' }));
      expect(await screen.findByText('Upload cancelled')).toBeTruthy();
      expect(screen.queryByRole('progressbar')).toBeNull();
      release();
      expect(actions.finishUpload).not.toHaveBeenCalled();
    });

    it('a part that fails stops the upload; Retry sends that part and the rest, then finishes', async () => {
      mockOf(actions.startUpload).mockResolvedValue(started(4));
      mockOf(actions.finishUpload).mockResolvedValue(ok({ jobId: 'j', file: 'cases.csv', rows: 2 }));
      mockOf(client.sendImportUploadChunk).mockResolvedValueOnce(ok({ received: [0] })).mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue(ok({ received: [] }));
      const { container } = await renderScreen();
      drop(container, fileOf('cases.csv', CSV));
      expect(await screen.findByText('Upload stopped')).toBeTruthy();
      expect(screen.getByText(/Part 2 of 4 did not arrive/)).toBeTruthy();
      expect(actions.finishUpload).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(actions.finishUpload).toHaveBeenCalledTimes(1));
      expect(mockOf(client.sendImportUploadChunk).mock.calls.map((c) => c[1])).toEqual([0, 1, 1, 2, 3]);
    });

    it('the data source is chosen before the drop: Synthetic in the demo, Imported sample on request, never Live data', async () => {
      mockOf(actions.startUpload).mockResolvedValue({ ok: false, code: 'invalid', message: 'stop here' });
      const { container } = await renderScreen();
      const group = screen.getByRole('radiogroup', { name: 'Data source' });
      expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Imported sample', 'Synthetic']);
      expect(within(group).getByRole('radio', { name: 'Synthetic' }).getAttribute('aria-checked')).toBe('true');
      fireEvent.click(within(group).getByRole('radio', { name: 'Imported sample' }));
      drop(container, fileOf('cases.csv', CSV));
      await waitFor(() => expect(actions.startUpload).toHaveBeenCalledWith(expect.objectContaining({ data_source: 'IMPORTED' })));
      expect(await screen.findByText('stop here')).toBeTruthy();
      expect(client.sendImportUploadChunk).not.toHaveBeenCalled();
    });

    it('a spreadsheet (.xlsx) is refused by the drop area with its own message, and nothing is sent (the api refuses it again)', async () => {
      const { container } = await renderScreen();
      drop(container, fileOf('cases.xlsx', 'x'));
      expect((await screen.findByRole('alert')).textContent).toContain('cases.xlsx');
      expect(actions.startUpload).not.toHaveBeenCalled();
    });

    it('a file over 1 GB is refused before anything is sent, with the limit in the message', async () => {
      const big = fileOf('big.csv', 'x');
      Object.defineProperty(big, 'size', { value: 2 ** 30 + 1 });
      const { container } = await renderScreen();
      drop(container, big);
      expect((await screen.findByRole('alert')).textContent).toMatch(/1,024 MB/);
      expect(actions.startUpload).not.toHaveBeenCalled();
    });

    it('the primary button starts the next step in the background with the job id only, shows its progress, then its result: Compare, Run dry run, Cut over', async () => {
      // Disposable: others read the shared partial job.
      const ctx = ctxOf();
      const built = await uploadImport(ctx, { file_name: 'screen_flow.csv', file: VALID_ROW, mapping_version: 'generic_csv_v1' });
      const job = { id: built.id };
      await validateImport(ctx, job.id);
      const compared = { jobId: job.id, existing: 1234, incoming: 103, added: 56, changed: 0, unchanged: 44, missing: 0 };
      mockOf(actions.startStep).mockResolvedValue(ok(stepView(job.id, 'compare', 'running', 'validated')));
      mockOf(actions.stepProgress).mockResolvedValueOnce(ok(stepView(job.id, 'compare', 'running', 'validated'))).mockResolvedValue(ok(stepView(job.id, 'compare', 'succeeded', 'compared', { kind: 'compare', value: compared })));
      await renderScreen({ search: { job: job.id } });
      fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
      await waitFor(() => expect(actions.startStep).toHaveBeenCalledWith({ jobId: job.id, step: 'compare' }));
      const bar = await screen.findByRole('progressbar');
      expect(bar.getAttribute('aria-valuenow')).toBe('3');
      expect(screen.getByText('3 of 4 rows read')).toBeTruthy();
      expect(await screen.findByText('Comparison ready', undefined, SLOW)).toBeTruthy();
      expect(actions.stepProgress).toHaveBeenCalledWith({ jobId: job.id });
      expect(env.router.refresh).toHaveBeenCalled();
      expect(screen.getByText('+56')).toBeTruthy();
      cleanup();

      // A comparison made by the one-request call keeps no figures: Compare again runs it in the background.
      await validateImport(ctx, job.id);
      await compareImport(ctx, job.id);
      stepRuns(job.id, 'compare', 'compared', 'compared', { kind: 'compare', value: compared });
      await renderScreen({ search: { job: job.id } });
      expect(screen.getByText('The figures are not kept after a reload.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Compare again' }));
      expect(await screen.findByText('Before', undefined, SLOW)).toBeTruthy();
      expect(screen.getByText('+56')).toBeTruthy();
      expect(screen.getByText('1,290')).toBeTruthy();
      expect(screen.getByText('Skipped, errors')).toBeTruthy();

      stepRuns(job.id, 'dry_run', 'compared', 'dry_run_done', { kind: 'dry_run', value: { jobId: job.id, blocking: 0, wouldInsert: 1, wouldUpdate: 0, wouldSkip: 0 } });
      await waitFor(() => expect(idle(screen.getByRole('button', { name: 'Run dry run' }))).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: 'Run dry run' }));
      await waitFor(() => expect(actions.startStep).toHaveBeenCalledWith({ jobId: job.id, step: 'dry_run' }));
      expect((await screen.findAllByText('Dry run passed', undefined, SLOW)).length).toBeGreaterThan(0);
      cleanup();

      await dryRunCutover(ctx, job.id);
      stepRuns(job.id, 'cut_over', 'dry_run_done', 'cut_over', { kind: 'cut_over', value: { jobId: job.id, inserted: 1, updated: 0 } });
      await renderScreen({ search: { job: job.id } });
      expect(screen.getAllByText('Dry run passed').length).toBeGreaterThan(0);
      expect(screen.getByText('Nothing blocks the cut-over.')).toBeTruthy();
      await waitFor(() => expect(idle(screen.getByRole('button', { name: 'Cut over' }))).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: 'Cut over' }));
      await waitFor(() => expect(actions.startStep).toHaveBeenCalledWith({ jobId: job.id, step: 'cut_over' }));
      expect(await screen.findByText('Cut over done', undefined, SLOW)).toBeTruthy();
      expect(JSON.stringify([mockOf(actions.startStep).mock.calls, mockOf(actions.stepProgress).mock.calls])).not.toMatch(FORBIDDEN);
    });

    it('a step that fails in the background shows its message inline', async () => {
      const job = await partial();
      mockOf(actions.startStep).mockResolvedValue(ok(stepView(job.id, 'compare', 'running', 'validated')));
      mockOf(actions.stepProgress).mockResolvedValue(ok({ ...stepView(job.id, 'compare', 'failed', 'validated'), error: 'The api stopped while this step ran, so nothing from it was kept. Run it again.' }));
      await renderScreen({ search: { job: job.id } });
      fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
      expect((await screen.findByText('The api stopped while this step ran, so nothing from it was kept. Run it again.', undefined, SLOW)).getAttribute('lang')).toBe('en');
    });

    it('shows View issues and lets it stay blocked when errors remain', async () => {
      // Disposable: "Run dry run" only shows once compared.
      const ctx = ctxOf();
      const built = await uploadImport(ctx, { file_name: 'blocked_flow.csv', file: VALID_ROW, mapping_version: 'generic_csv_v1' });
      const job = { id: built.id };
      await validateImport(ctx, job.id);
      await compareImport(ctx, job.id);
      stepRuns(job.id, 'dry_run', 'compared', 'compared', { kind: 'dry_run', value: { jobId: job.id, blocking: 3, wouldInsert: 637, wouldUpdate: 0, wouldSkip: 3 } });
      await renderScreen({ search: { job: job.id } });
      await waitFor(() => expect(idle(screen.getByRole('button', { name: 'Run dry run' }))).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: 'Run dry run' }));
      await waitFor(() => expect(actions.startStep).toHaveBeenCalledWith({ jobId: job.id, step: 'dry_run' }));
      expect(await screen.findByText('Cut-over blocked', undefined, SLOW)).toBeTruthy();
      expect(screen.getAllByText('3 errors must be resolved or ignored first.').length).toBeGreaterThan(0);
      fireEvent.click(screen.getAllByRole('button', { name: 'View issues' })[0] as HTMLElement);
      expect(env.router.replace).toHaveBeenCalledWith(expect.stringMatching(/tab=issues.*severity=error|severity=error.*tab=issues/), expect.anything());
    });

    it('a refusal stays inline with its translated line and the English detail', async () => {
      // Explicit job: an earlier test's disposable upload may now be "newest".
      const job = await partial();
      mockOf(actions.startStep).mockResolvedValue({ ok: false, code: 'conflict', message: 'Cannot compare an import that is uploaded.' });
      await renderScreen({ search: { job: job.id } });
      fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
      expect(await screen.findByText('That is not possible in its current state.')).toBeTruthy();
      expect(screen.getByText('Cannot compare an import that is uploaded.').getAttribute('lang')).toBe('en');
    });

    it('More has Download mapping and Export issues, each saving a CSV', async () => {
      await renderScreen({ search: { tab: 'issues', severity: 'error' } });
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download mapping' }));
      const [file, table] = env.saved.mock.calls[0] as [string, { header: string[]; rows: string[][] }];
      expect(file).toBe('customer-case-extract-v1-mapping.csv');
      expect(table.header).toEqual(['Column in the file', 'Field', 'Required']);
      expect(table.rows.length).toBeGreaterThan(10);
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export issues' }));
      const [name, issues] = env.saved.mock.calls[1] as [string, { header: string[]; rows: string[][] }];
      expect(name).toBe('data-quality-issues.csv');
      expect(issues.rows.every((r) => r[0] === 'Error')).toBe(true);
    });
  });

  describe('rolling back a cut-over', () => {
    it('asks first, then sends the job id only; Cancel sends nothing', async () => {
      const cut = (await jobs()).find((j) => j.status === 'cut_over');
      if (cut === undefined) throw new Error('no cut-over job in the fixtures');
      stepRuns(cut.id, 'rollback', 'cut_over', 'rolled_back', { kind: 'rollback', value: { jobId: cut.id, deleted: 637, restored: 0 } });
      await renderScreen({ search: { job: cut.id } });
      fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Roll back this cut-over?')).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(actions.startStep).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Roll back' }));
      await waitFor(() => expect(actions.startStep).toHaveBeenCalledWith({ jobId: cut.id, step: 'rollback' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(await screen.findByText('Cut-over rolled back', undefined, SLOW)).toBeTruthy();
      expect(JSON.stringify(mockOf(actions.startStep).mock.calls)).not.toMatch(FORBIDDEN);
    });

    it('is disabled with the reason for a view-only role', async () => {
      const cut = (await jobs()).find((j) => j.status === 'cut_over');
      await renderScreen({ access: 'view', search: { job: cut?.id } });
      expect(disabled(screen.getByRole('button', { name: 'Roll back' }))).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(actions.startStep).not.toHaveBeenCalled();
    });
  });

  describe('a view-only role', () => {
    it('sees every control disabled with the reason, and no action is called', async () => {
      // Explicit job: an earlier test's disposable upload may now be "newest".
      const job = await partial();
      const { container } = await renderScreen({ access: 'view', search: { job: job.id } });
      expect(screen.getByText('View only')).toBeTruthy();
      expect(disabled(screen.getByRole('button', { name: 'Upload file' }))).toBe(true);
      expect(disabled(screen.getByRole('button', { name: 'Compare' }))).toBe(true);
      expect((container.querySelector('input[type="file"]') as HTMLInputElement).matches(':disabled')).toBe(true);
      expect(screen.getAllByText('View only for this role').length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
      expect(actions.startStep).not.toHaveBeenCalled();
      cleanup();
      const issue = (await listDataQualityIssues(ctxOf(), { limit: 1 })).items[0];
      await renderScreen({ access: 'view', search: { tab: 'issues', issue: issue?.id } });
      expect(disabled(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))).toBe(true);
    });
  });

  describe('the review states (?state=)', () => {
    it.each(['empty', 'loading', 'error'] as const)('?state=%s shows that state, keeps the header, and reads nothing', async (state) => {
      const { container } = await renderScreen({ state });
      expect(root(container)?.getAttribute('data-state')).toBe(state);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Data Import and Quality');
      if (state === 'empty') {
        expect(screen.getByText('No imports yet')).toBeTruthy();
        expect(screen.getByText('Upload a CSV file in Customer format.')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Upload file' }).length).toBeGreaterThan(0);
      }
      if (state === 'error') {
        expect(screen.getByRole('alert').textContent).toContain('The imports could not load.');
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
      }
      if (state === 'loading') expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    });
  });

  describe('Arabic', () => {
    it('draws every tab in Arabic with no English left outside data, Western digits, and the drop area hint in Arabic', async () => {
      for (const tab of ['import', 'issues', 'jobs']) {
        const { container } = await renderScreen({ locale: 'ar', search: { tab } });
        expect(dataText(container), tab).not.toMatch(/[A-Za-z]{3}/);
        expect(container.textContent, tab).not.toMatch(/[٠-٩]/);
        cleanup();
      }
    });

    it('draws the states in Arabic', async () => {
      for (const state of ['empty', 'error'] as const) {
        const { container } = await renderScreen({ locale: 'ar', state });
        expect(dataText(container)).not.toMatch(/[A-Za-z]{3}/);
        cleanup();
      }
    });
  });

  describe('case facts (api-backed locations)', () => {
    it('shows the case behind an issue with handling as "inferred"', async () => {
      const withCase = (await listDataQualityIssues(ctxOf(), { limit: 200 })).items.find((i) => i.case_id !== null && i.case_id !== undefined);
      if (withCase === undefined) return;
      await renderScreen({ search: { tab: 'issues', issue: withCase.id } });
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Case number')).toBeTruthy();
      expect(within(dialog).getByText('inferred')).toBeTruthy();
    });
  });
});
