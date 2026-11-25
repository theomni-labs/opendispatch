// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { listCaseTypes, listCases } from '@/lib/data/cases';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listDataQualityIssues, listImportJobs, listImportMappings } from '@/lib/data/imports';
import { listCities, listSubZones, listZones } from '@/lib/data/locations';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { compareJob, cutOverJob, dryRunJob, rollBackJob, setIssueStatus, uploadImportFile, validateJob } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// ImportJob/DataQualityIssue/Case is api-backed: every action
// here needs the api now (was actions.test.ts too).
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

// The server actions against the real data layer and the committed fixtures, with the demo store in a temp folder. The session
// is the only thing stood in for: requireRequestContext returns the context of the role the test picks, exactly what a signed
// cookie would give. The CSV files are written here from the mapping and the location
// fixtures (synthetic; nothing real).
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

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  session.role = 'administrator';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});

async function ctx(): Promise<RequestContext> {
  return contextOf('administrator', 'private');
}
const events = async (action: string) => (await listAuditEvents(await ctx(), { action, limit: 200 })).items;
const REVALIDATED = ['/en/admin/data-import-quality', '/ar/admin/data-import-quality'];

// Postgres persists across tests in this file: each call needs its own external_ids.
let nextCallOffset = 0;

/** A synthetic CSV in the mapping's format: `count` valid rows that reference locations of the fixtures. */
async function syntheticCsv(count: number, tweak: (cells: Record<string, string>, index: number) => void = () => undefined): Promise<string> {
  nextCallOffset += 1000;
  const base = 1000 + nextCallOffset;
  const c = await ctx();
  const mapping = (await listImportMappings(c, { limit: 5 })).items[0];
  const zone = (await listZones(c, { limit: 50 })).items.find((z) => z.external_id !== null && z.external_id !== undefined);
  const sub = (await listSubZones(c, { limit: 200 })).items.find((s) => s.zone_id === zone?.id && s.external_id !== null && s.external_id !== undefined);
  const city = (await listCities(c, { limit: 50 })).items.find((x) => x.id === zone?.city_id);
  const type = (await listCaseTypes(c, { limit: 10 })).items.find((x) => x.external_id !== null && x.external_id !== undefined);
  if (mapping === undefined || zone === undefined || sub === undefined || city === undefined || type === undefined) throw new Error('fixtures are missing a reference');
  const header = mapping.columns.map((col) => col.source_column);
  const lines = [header.join(',')];
  for (let i = 0; i < count; i += 1) {
    const cells: Record<string, string> = {
      RecordID: `SYN-${base + i}`,
      CaseNumber: `RD-260913-9${String(base + i).padStart(4, '0')}`,
      RegisteredTime: '2026-09-13 08:00:00',
      CityID: city.external_id as string,
      CityNameEn: city.name_en,
      ZoneID: zone.external_id as string,
      ZoneNameEn: zone.name_en,
      SubZoneID: sub.external_id as string,
      SubZoneNameEn: sub.name_en,
      Latitude: '24.7',
      Longitude: '46.7',
      CaseTypeID: type.external_id as string,
      CaseTypeNameEn: type.name_en,
      PartyCount: '2',
      AssignedTime: '2026-09-13 08:05:00',
      ArrivalTime: '',
      ClosingTime: '',
    };
    tweak(cells, i);
    lines.push(header.map((h) => cells[h] ?? '').join(','));
  }
  return `${lines.join('\n')}\n`;
}

const upload = async (file: string, name = 'synthetic_test.csv') => uploadImportFile({ file_name: name, file, mapping_version: 'generic_csv_v1' });

describe.skipIf(!hasApi)('the flow: upload, validate, compare, dry run, cut over', () => {
  it('takes a synthetic CSV all the way and adds its cases, each step audited; the page is refreshed in both languages', async () => {
    const before = (await listCases(await ctx(), { limit: 1 })).page.total ?? 0;
    const up = await upload(await syntheticCsv(3));
    expect(up).toMatchObject({ ok: true, data: { file: 'synthetic_test.csv', rows: 3 } });
    if (!up.ok) throw new Error('unreachable');
    const jobId = up.data.jobId;
    expect((await listImportJobs(await ctx(), { limit: 10 })).items[0]).toMatchObject({ id: jobId, status: 'uploaded' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(REVALIDATED);

    expect(await validateJob({ jobId })).toMatchObject({ ok: true, data: { status: 'validated', errors: 0 } });
    expect(await compareJob({ jobId })).toMatchObject({ ok: true, data: { added: 3, changed: 0, existing: before } });
    expect(await dryRunJob({ jobId })).toMatchObject({ ok: true, data: { blocking: 0, wouldInsert: 3 } });
    expect((await listImportJobs(await ctx(), { limit: 10 })).items.find((j) => j.id === jobId)?.status).toBe('dry_run_done');
    expect(await cutOverJob({ jobId })).toMatchObject({ ok: true, data: { inserted: 3, updated: 0 } });
    expect((await listCases(await ctx(), { limit: 1 })).page.total).toBe(before + 3);
    for (const action of ['import.uploaded', 'import.validated', 'import.compared', 'import.dry_run', 'import.cut_over']) expect((await events(action)).at(0), action).toMatchObject({ outcome: 'success' });
  });

  it('labels the job with the data source chosen on screen (Imported sample when none), never Live data', async () => {
    const synthetic = await uploadImportFile({ file_name: 'synthetic_rehearsal.csv', file: await syntheticCsv(1), mapping_version: 'generic_csv_v1', data_source: 'SYNTHETIC' });
    if (!synthetic.ok) throw new Error('unreachable');
    const plain = await upload(await syntheticCsv(1));
    if (!plain.ok) throw new Error('unreachable');
    const jobs = (await listImportJobs(await ctx(), { limit: 200 })).items;
    expect(jobs.find((j) => j.id === synthetic.data.jobId)?.data_source).toBe('SYNTHETIC');
    expect(jobs.find((j) => j.id === plain.data.jobId)?.data_source).toBe('IMPORTED');
    expect(await uploadImportFile({ file_name: 'live.csv', file: await syntheticCsv(1), mapping_version: 'generic_csv_v1', data_source: 'LIVE' as never })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('the administrator rolls a cut-over back: its cases go, the job says rolled back, audited; a second roll-back conflicts', async () => {
    const before = (await listCases(await ctx(), { limit: 1 })).page.total ?? 0;
    const up = await upload(await syntheticCsv(2));
    if (!up.ok) throw new Error('unreachable');
    const jobId = up.data.jobId;
    expect(await rollBackJob({ jobId })).toMatchObject({ ok: false, code: 'conflict' });
    await validateJob({ jobId });
    await compareJob({ jobId });
    await dryRunJob({ jobId });
    expect(await cutOverJob({ jobId })).toMatchObject({ ok: true, data: { inserted: 2 } });
    expect((await listCases(await ctx(), { limit: 1 })).page.total).toBe(before + 2);
    expect(await rollBackJob({ jobId })).toMatchObject({ ok: true, data: { deleted: 2, restored: 0 } });
    expect((await listCases(await ctx(), { limit: 1 })).page.total).toBe(before);
    expect((await listImportJobs(await ctx(), { limit: 200 })).items.find((j) => j.id === jobId)?.status).toBe('rolled_back');
    expect((await events('import.rolled_back')).at(0)).toMatchObject({ outcome: 'success' });
    expect(await rollBackJob({ jobId })).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('a cut-over needs a dry run that passed first, and a job cut over cannot be validated again (conflicts)', async () => {
    const up = await upload(await syntheticCsv(2));
    if (!up.ok) throw new Error('unreachable');
    const jobId = up.data.jobId;
    expect(await compareJob({ jobId })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await cutOverJob({ jobId })).toMatchObject({ ok: false, code: 'conflict' });
    await validateJob({ jobId });
    await compareJob({ jobId });
    await dryRunJob({ jobId });
    await cutOverJob({ jobId });
    expect(await validateJob({ jobId })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await cutOverJob({ jobId })).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('rows with errors are found by validation, kept out of the cut-over, and block it until they are resolved or ignored', async () => {
    const csv = await syntheticCsv(3, (cells, i) => {
      if (i === 1) cells['Latitude'] = '91.2';
      if (i === 2) cells['RegisteredTime'] = '';
    });
    const up = await upload(csv);
    if (!up.ok) throw new Error('unreachable');
    const jobId = up.data.jobId;
    expect(await validateJob({ jobId })).toMatchObject({ ok: true, data: { status: 'validated', errors: 2 } });
    expect(await compareJob({ jobId })).toMatchObject({ ok: true, data: { added: 1 } });
    expect(await dryRunJob({ jobId })).toMatchObject({ ok: true, data: { blocking: 2, wouldInsert: 1 } });
    expect((await listImportJobs(await ctx(), { limit: 10 })).items.find((j) => j.id === jobId)?.status).toBe('compared');
    expect(await cutOverJob({ jobId })).toMatchObject({ ok: false, code: 'conflict' });
    const errors = (await listDataQualityIssues(await ctx(), { import_job_id: jobId, severity: 'error', limit: 20 })).items;
    expect(errors).toHaveLength(2);
    expect(await setIssueStatus({ issueId: errors[0]?.id as string, status: 'ignored', note: 'Known bad row' })).toMatchObject({ ok: true, data: { status: 'ignored' } });
    expect(await setIssueStatus({ issueId: errors[1]?.id as string, status: 'resolved', note: '' })).toMatchObject({ ok: true, data: { status: 'resolved' } });
    expect(await dryRunJob({ jobId })).toMatchObject({ ok: true, data: { blocking: 0 } });
    expect(await cutOverJob({ jobId })).toMatchObject({ ok: true, data: { inserted: 1 } });
    expect((await events('data_quality.issue_updated')).length).toBe(2);
    expect(JSON.stringify((await events('data_quality.issue_updated')).at(1)?.detail)).toContain('Known bad row');
  });
});

describe.skipIf(!hasApi)('mappings, jobs and issues (fixtures)', () => {
  it('lists the three fixture jobs', async () => {
    const ctxAdmin = await ctx();
    const jobs = await listImportJobs(ctxAdmin, { limit: 200 });
    expect(jobs.items.length).toBeGreaterThanOrEqual(3);
  });

  it('lists the issue log and filters it by status, severity and job', async () => {
    const ctxAdmin = await ctx();
    const issues = await listDataQualityIssues(ctxAdmin, { limit: 200 });
    expect(issues.page.total ?? issues.items.length).toBeGreaterThan(0);
    expect((await listDataQualityIssues(ctxAdmin, { severity: 'error', limit: 200 })).items.every((i) => i.severity === 'error')).toBe(true);
    expect((await listDataQualityIssues(ctxAdmin, { status: 'ignored', limit: 200 })).items.every((i) => i.status === 'ignored')).toBe(true);
  });

  it('is for the Administrator only', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      session.role = role;
      expect(await uploadImportFile({ file_name: 'x.csv', file: 'RecordID,CaseNumber\n1,x\n', mapping_version: 'generic_csv_v1' })).toMatchObject({ ok: false, code: 'forbidden' });
    }
    session.role = 'administrator';
    expect((await events('import.uploaded')).some((e) => e.outcome === 'denied')).toBe(true);
  });
});

describe.skipIf(!hasApi)('a disposable stand-in for the scripted partial extract', () => {
  // The real "partial" job is shared with other files.
  it('has three errors that block the cut-over until they are resolved or ignored, then cuts over', async () => {
    const csv = await syntheticCsv(5, (cells, i) => {
      if (i === 1) cells['Latitude'] = '91.2';
      if (i === 2) cells['RegisteredTime'] = '';
      if (i === 3) cells['ZoneID'] = 'zz-no-such-zone';
    });
    // Not "partial": Screen.live.test.tsx's own partial() substring-matches that word.
    const up = await upload(csv, 'blocked_extract_stand_in.csv');
    if (!up.ok) throw new Error('unreachable');
    const jobId = up.data.jobId;
    await validateJob({ jobId });
    expect(await dryRunJob({ jobId })).toMatchObject({ ok: false, code: 'conflict' });
    const compared = await compareJob({ jobId });
    expect(compared).toMatchObject({ ok: true, data: { added: 2 } });
    const blocked = await dryRunJob({ jobId });
    expect(blocked).toMatchObject({ ok: true, data: { blocking: 3 } });
    expect(await cutOverJob({ jobId })).toMatchObject({ ok: false, code: 'conflict' });
    for (const issue of (await listDataQualityIssues(await ctx(), { import_job_id: jobId, severity: 'error', limit: 20 })).items) await setIssueStatus({ issueId: issue.id, status: 'ignored', note: '' });
    expect(await dryRunJob({ jobId })).toMatchObject({ ok: true, data: { blocking: 0, wouldInsert: 2 } });
    const before = (await listCases(await ctx())).page.total ?? 0;
    expect(await cutOverJob({ jobId })).toMatchObject({ ok: true });
    expect((await listCases(await ctx())).page.total).toBe(before + 2);
  });
});

describe.skipIf(!hasApi)('the file is checked a second time by the data layer', () => {
  it('refuses a spreadsheet (.xlsx), an unknown mapping version, an empty file and one over 8,000,000 characters, as `invalid`, storing nothing', async () => {
    const before = (await listImportJobs(await ctx(), { limit: 200 })).items.length;
    expect(await uploadImportFile({ file_name: 'cases.xlsx', file: 'a,b', mapping_version: 'generic_csv_v1' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await uploadImportFile({ file_name: 'cases.csv', file: 'a,b', mapping_version: 'customer_case_v9' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await uploadImportFile({ file_name: 'cases.csv', file: '', mapping_version: 'generic_csv_v1' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await uploadImportFile({ file_name: 'cases.csv', file: 'x'.repeat(8_000_001), mapping_version: 'generic_csv_v1' })).toMatchObject({ ok: false, code: 'invalid' });
    const xlsx = await uploadImportFile({ file_name: 'cases.xlsx', file: 'a,b', mapping_version: 'generic_csv_v1' });
    if (!xlsx.ok) expect(xlsx.message).toMatch(/CSV/);
    expect((await listImportJobs(await ctx(), { limit: 200 })).items.length).toBe(before);
  });

  it('refuses hostile job and issue ids, an unknown one (not found), and a status or note that is not allowed', async () => {
    for (const bad of ['', 'toString', '__proto__', '../etc', 42, null, undefined]) {
      expect(await validateJob({ jobId: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
      expect(await setIssueStatus({ issueId: bad as never, status: 'open', note: '' }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(await validateJob({ jobId: '00000000-0000-4000-8000-000000000001' })).toMatchObject({ ok: false, code: 'not_found' });
    const issue = (await listDataQualityIssues(await ctx(), { limit: 1 })).items[0];
    expect(await setIssueStatus({ issueId: issue?.id as string, status: 'deleted', note: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await setIssueStatus({ issueId: issue?.id as string, status: 'open', note: 'x'.repeat(501) })).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe.skipIf(!hasApi)('who may write, and what is audited', () => {
  const nil = '00000000-0000-4000-8000-000000000001';
  const writes: readonly [string, () => Promise<{ ok: boolean; code?: string }>, string][] = [
    ['uploadImportFile', () => upload('a,b\n1,2\n'), 'import.uploaded'],
    ['validateJob', () => validateJob({ jobId: nil }), 'import.validated'],
    ['compareJob', () => compareJob({ jobId: nil }), 'import.compared'],
    ['dryRunJob', () => dryRunJob({ jobId: nil }), 'import.dry_run'],
    ['cutOverJob', () => cutOverJob({ jobId: nil }), 'import.cut_over'],
    ['rollBackJob', () => rollBackJob({ jobId: nil }), 'import.rolled_back'],
    ['setIssueStatus', () => setIssueStatus({ issueId: nil, status: 'open', note: '' }), 'data_quality.issue_updated'],
  ];

  it.each(writes)('%s is refused for a role with no edit access, audited as denied, and changes nothing', async (_name, call, action) => {
    const jobsBefore = JSON.stringify((await listImportJobs(await ctx(), { limit: 200 })).items);
    for (const role of ['planner', 'viewer_auditor', 'dispatch_supervisor', 'change_approver'] as const) {
      session.role = role;
      expect(await call(), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    session.role = 'administrator';
    expect((await events(action)).some((e) => e.outcome === 'denied')).toBe(true);
    expect(session.revalidate).not.toHaveBeenCalled();
    expect(JSON.stringify((await listImportJobs(await ctx(), { limit: 200 })).items)).toBe(jobsBefore);
  });

  it('every write answers `unauthenticated` with no session, and touches nothing', async () => {
    session.role = null;
    for (const [, call] of writes) expect(await call()).toMatchObject({ ok: false, code: 'unauthenticated' });
    expect(session.revalidate).not.toHaveBeenCalled();
  });
});

describe.skipIf(!hasApi)('an unexpected error', () => {
  it('returns a reference ODP- and 8 hex characters, logs only that reference and the error name, and leaks no input', async () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: file=secret-case-rows token=hunter2');
        },
      },
    );
    const result = await uploadImportFile(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result)).not.toMatch(/secret-case-rows|hunter2|boom/);
    const logged = errorLog.mock.calls.flat().join('\n');
    expect(logged).toContain(result.reference);
    expect(logged).not.toMatch(/secret-case-rows|hunter2|boom|token/);
    expect(session.revalidate).not.toHaveBeenCalled();
  });
});
