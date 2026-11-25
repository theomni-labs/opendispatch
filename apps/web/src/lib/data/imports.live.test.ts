// SPDX-License-Identifier: AGPL-3.0-only
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// ImportJob/DataQualityIssue/Case is api-backed. Seeded
// from the same manifest as everywhere else, so the
// three scripted fixture jobs exist in Postgres too.
// Total counts (jobs, cases, issues) are floors: a
// concurrent live test file (e.g. data_import_quality's
// own actions.live.test.ts) may add more of any of
// them while this runs. Deltas captured within one
// test (before/after) stay exact.

import { describe, expect, it } from 'vitest';
import type { Case, DataQualityIssue, ImportJob } from '@/lib/types';
import { listAuditEvents } from './audit';
import { listCases } from './cases';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { compareImport, dryRunCutover, executeCutover, getImportJob, listDataQualityIssues, listImportIssues, listImportJobs, updateDataQualityIssue, uploadImport, validateImport } from './imports';
import { ctxFor, withTempDemoState } from './test-support';

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

describe.skipIf(!hasApi)('imports (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: imports.live.test.ts is skipped, not faked.');

  withTempDemoState();

  const admin = () => ctxFor('administrator');
  const OTHERS = ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const;

  const HEADER = 'RecordID,CaseNumber,RegisteredTime,CityID,CityNameEn,ZoneID,ZoneNameEn,SubZoneID,SubZoneNameEn,Latitude,Longitude,CaseTypeID,CaseTypeNameEn,PartyCount,AssignedTime,ArrivalTime,ClosingTime';

  // A fresh, disposable case number per file: mutating tests must not collide on external_id.
  let nextOffset = 0;
  function freshIds(): { readonly a: string; readonly b: string } {
    nextOffset += 1;
    const n = 9200000 + nextOffset * 10;
    return { a: String(n), b: String(n + 1) };
  }

  /** A small synthetic file in the customer format, built from real reference ids. Row 3 has a bad zone, row 4 a bad latitude. */
  function syntheticFile(): { readonly file: string; readonly caseNumbers: readonly [string, string] } {
    const { a, b } = freshIds();
    const numbers: [string, string] = [`RD-260920-${a}`, `RD-260920-${b}`];
    const good = (id: string, number: string, at: string): string => `${id},${number},${at},101,Riyadh,2001,Riyadh Central,30001,Juniper Square,24.71,46.68,1,Standard case,2,${at.replace('08:00', '08:03')},${at.replace('08:00', '08:12')},${at.replace('08:00', '08:40')}`;
    const file = [
      HEADER,
      good(a, numbers[0], '2026-09-20 08:00:00'),
      good(b, numbers[1], '2026-09-20 08:00:00'),
      `${a}3,RD-260920-${a}3,2026-09-20 08:00:00,101,Riyadh,2099,Nowhere,30001,Juniper Square,24.71,46.68,1,Standard case,2,,,`,
      `${a}4,RD-260920-${a}4,2026-09-20 08:00:00,101,Riyadh,2001,Riyadh Central,30001,Juniper Square,91.2,46.68,1,Standard case,2,,,`,
      `${b},RD-260920-${a}5,2026-09-20 08:00:00,101,RIYADH,2001,Riyadh Central,30001,Juniper Square,24.71,46.68,2,Police attended,1,2026-09-20 07:55:00,,`,
    ].join('\n');
    return { file, caseNumbers: numbers };
  }

  describe('jobs and issues (fixtures)', () => {
    it('lists the three fixture jobs', async () => {
      const ctx = admin();
      const jobs = await listImportJobs(ctx);
      expect(jobs.items.length).toBeGreaterThanOrEqual(fixtureRecords<ImportJob>('ImportJob').length);
      const first = jobs.items[0]!;
      const got = await getImportJob(ctx, first.id);
      expect(got.id).toBe(first.id);
      await expect(getImportJob(ctx, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
    });

    it('lists the issue log and filters it by status, severity and job', async () => {
      const ctx = admin();
      const issues = await listDataQualityIssues(ctx, { limit: 200 });
      expect(issues.page.total ?? issues.items.length).toBeGreaterThanOrEqual(fixtureRecords<DataQualityIssue>('DataQualityIssue').length);
      expect((await listDataQualityIssues(ctx, { severity: 'error', limit: 200 })).items.every((i) => i.severity === 'error')).toBe(true);
      expect((await listDataQualityIssues(ctx, { status: 'ignored', limit: 200 })).items.every((i) => i.status === 'ignored')).toBe(true);
      const partial = (await listImportJobs(ctx, { limit: 200 })).items.find((j) => j.status === 'validated' && j.row_count === 640)!;
      const forJob = await listImportIssues(ctx, partial.id);
      expect(forJob.items).toHaveLength(4);
      expect(forJob.items[0]!.severity).toBe('error');
    });

    it('is for the Administrator only', async () => {
      for (const role of OTHERS) {
        await expect(listImportJobs(ctxFor(role))).rejects.toThrow(ForbiddenError);
        await expect(uploadImport(ctxFor(role), { file: HEADER, mapping_version: 'generic_csv_v1' })).rejects.toThrow(ForbiddenError);
      }
      expect((await listAuditEvents(admin(), { outcome: 'denied', action: 'import.uploaded' })).items.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('flow 5 with a synthetic file: upload, validate, compare, dry-run, cut over', () => {
    it('validates the file with the mapping rules and reports the issues', async () => {
      const ctx = admin();
      const job = await uploadImport(ctx, { file_name: 'synthetic_test.csv', file: syntheticFile().file, mapping_version: 'generic_csv_v1' });
      expect(job).toMatchObject({ status: 'uploaded', row_count: 5, file_name: 'synthetic_test.csv' });
      const validated = await validateImport(ctx, job.id);
      expect(validated.status).toBe('validated');
      const issues = (await listImportIssues(ctx, job.id, { limit: 100 })).items;
      const types = issues.map((i) => `${i.row_number}:${i.issue_type}:${i.severity}`).sort();
      expect(types).toEqual(
        ['4:unknown_reference:error', '5:out_of_range_coordinate:error', '6:duplicate_external_id:warning', '6:assigned_before_registered:warning', '6:unusual_parties_count:warning', '6:inconsistent_name_case:info'].sort(),
      );
      expect(validated).toMatchObject({ issue_count: 6, error_count: 2, warning_count: 3 });
      expect(issues.every((i) => i.status === 'open' && i.import_job_id === job.id)).toBe(true);
    });

    it('fails a file whose header lacks required columns', async () => {
      const ctx = admin();
      const job = await uploadImport(ctx, { file_name: 'bad_header.csv', file: 'RecordID,Latitude\n1,24.7', mapping_version: 'generic_csv_v1' });
      const result = await validateImport(ctx, job.id);
      expect(result.status).toBe('failed');
      const issues = (await listImportIssues(ctx, job.id, { limit: 100 })).items;
      expect(issues.length).toBeGreaterThan(5);
      expect(issues.every((i) => i.issue_type === 'missing_required_field' && i.severity === 'error' && i.row_number === null)).toBe(true);
      await expect(compareImport(ctx, job.id)).rejects.toThrow(ConflictError);
    });

    it('compares, dry-runs and cuts over: errors block until resolved or ignored, and the cases appear as IMPORTED', async () => {
      const ctx = admin();
      const before = (await listCases(ctx)).page.total ?? 0;
      const { file, caseNumbers } = syntheticFile();
      const job = await uploadImport(ctx, { file_name: 'synthetic_test.csv', file, mapping_version: 'generic_csv_v1' });
      await expect(compareImport(ctx, job.id)).rejects.toThrow(ConflictError);
      await validateImport(ctx, job.id);
      const comparison = await compareImport(ctx, job.id);
      expect(comparison).toMatchObject({ incoming_case_count: 5, new_count: 2, changed_count: 0, unchanged_count: 0 });
      expect(comparison.existing_case_count).toBeGreaterThanOrEqual(fixtureRecords<Case>('Case').length);
      expect((await getImportJob(ctx, job.id)).status).toBe('compared');
      const blocked = await dryRunCutover(ctx, job.id);
      expect(blocked).toMatchObject({ dry_run: true, applied: false, blocking_issue_count: 2, would_insert: 2, would_skip: 3 });
      expect((await getImportJob(ctx, job.id)).status).toBe('compared');
      await expect(executeCutover(ctx, job.id)).rejects.toThrow(ConflictError);
      for (const issue of (await listImportIssues(ctx, job.id, { limit: 100 })).items.filter((i) => i.severity === 'error')) {
        await updateDataQualityIssue(ctx, issue.id, { status: issue.issue_type === 'unknown_reference' ? 'resolved' : 'ignored', note: 'Checked with the data owner.' });
      }
      const passed = await dryRunCutover(ctx, job.id);
      expect(passed).toMatchObject({ blocking_issue_count: 0, would_insert: 2 });
      expect((await getImportJob(ctx, job.id)).status).toBe('dry_run_done');
      expect((await listCases(ctx)).page.total).toBe(before);
      const done = await executeCutover(ctx, job.id);
      expect(done).toMatchObject({ dry_run: false, applied: true, would_insert: 2 });
      expect(await getImportJob(ctx, job.id)).toMatchObject({ status: 'cut_over' });
      expect((await getImportJob(ctx, job.id)).cut_over_at).not.toBeNull();
      const added = await listCases(ctx, { q: caseNumbers[0] });
      expect(added.items.map((c) => c.case_number)).toEqual([caseNumbers[0]]);
      for (const number of caseNumbers) {
        const found = (await listCases(ctx, { q: number })).items.find((c) => c.case_number === number);
        expect(found).toMatchObject({ data_source: 'IMPORTED', handling: 'field' });
      }
      await expect(executeCutover(ctx, job.id)).rejects.toThrow(ConflictError);
      await expect(validateImport(ctx, job.id)).rejects.toThrow(ConflictError);
      const actions = (await listAuditEvents(ctx, { limit: 30 })).items.map((e) => e.action);
      for (const action of ['import.uploaded', 'import.validated', 'import.compared', 'import.dry_run', 'import.cut_over', 'data_quality.issue_updated']) expect(actions).toContain(action);
    });

    it('updates rows already held when the file changes them, and counts unchanged ones', async () => {
      const ctx = admin();
      const existing = fixtureRecords<Case>('Case')[0]!;
      const csv = [
        HEADER,
        `${existing.external_id},${existing.case_number},${existing.registered_at.slice(0, 19).replace('T', ' ')},101,Riyadh,2001,Riyadh Central,30001,Juniper Square,${existing.latitude},${existing.longitude},1,Standard case,${existing.parties_involved + 1},,,`,
      ].join('\n');
      const job = await uploadImport(ctx, { file_name: 'changes.csv', file: csv, mapping_version: 'generic_csv_v1' });
      await validateImport(ctx, job.id);
      const comparison = await compareImport(ctx, job.id);
      expect(comparison).toMatchObject({ incoming_case_count: 1, changed_count: 1, new_count: 0 });
      expect(comparison.missing_from_import_count).toBeGreaterThan(1000);
    });

    it('refuses spreadsheets, unknown mappings and unknown fields', async () => {
      const ctx = admin();
      await expect(uploadImport(ctx, { file_name: 'cases.xlsx', file: 'x', mapping_version: 'generic_csv_v1' })).rejects.toThrow(InvalidInputError);
      await expect(uploadImport(ctx, { file_name: 'cases.csv', file: HEADER, mapping_version: 'customer_case_v9' })).rejects.toThrow(InvalidInputError);
      await expect(uploadImport(ctx, { file: HEADER, mapping_version: 'generic_csv_v1', role: 'administrator' })).rejects.toThrow(InvalidInputError);
    });
  });

  describe('flow 5 with the demo partial extract (scripted from the fixtures)', () => {
    it('has three errors that block the cut-over until they are resolved or ignored, then adds the replay-day cases', async () => {
      const ctx = admin();
      const job = (await listImportJobs(ctx, { limit: 200 })).items.find((j) => j.file_name.includes('partial'))!;
      expect(job).toMatchObject({ status: 'validated', row_count: 640, error_count: 3 });
      await expect(dryRunCutover(ctx, job.id)).rejects.toThrow(ConflictError);
      const comparison = await compareImport(ctx, job.id);
      expect(comparison).toMatchObject({ incoming_case_count: 640, new_count: 637 });
      const blocked = await dryRunCutover(ctx, job.id);
      expect(blocked.blocking_issue_count).toBe(3);
      await expect(executeCutover(ctx, job.id)).rejects.toThrow(ConflictError);
      for (const issue of (await listImportIssues(ctx, job.id)).items.filter((i) => i.severity === 'error')) await updateDataQualityIssue(ctx, issue.id, { status: 'ignored' });
      expect(await dryRunCutover(ctx, job.id)).toMatchObject({ blocking_issue_count: 0, would_insert: 637, would_skip: 3 });
      const before = (await listCases(ctx)).page.total ?? 0;
      await executeCutover(ctx, job.id);
      // Floors, not exact matches: the Case table is shared across the whole
      // sweep, and another concurrent file's own cutover/case-creation can
      // grow these counts further without this test's own cutover being
      // wrong -- only inserting fewer than our own 637 rows would be a bug.
      expect((await listCases(ctx)).page.total).toBeGreaterThanOrEqual(before + 637);
      expect((await listCases(ctx, { date_from: '2026-09-13', date_to: '2026-09-13' })).page.total).toBeGreaterThanOrEqual(637);
    });

    it('keeps the already cut over job and the failed job closed', async () => {
      const ctx = admin();
      const jobs = (await listImportJobs(ctx, { limit: 200 })).items;
      const cutOver = jobs.find((j) => j.status === 'cut_over')!;
      const failed = jobs.find((j) => j.status === 'failed')!;
      await expect(compareImport(ctx, cutOver.id)).rejects.toThrow(ConflictError);
      await expect(validateImport(ctx, cutOver.id)).rejects.toThrow(ConflictError);
      await expect(compareImport(ctx, failed.id)).rejects.toThrow(ConflictError);
      expect((await validateImport(ctx, failed.id)).status).toBe('failed');
    });
  });
});
