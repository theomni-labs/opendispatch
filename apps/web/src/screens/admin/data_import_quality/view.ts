// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Data Import and Quality screen: reads through lib/data with the request context and returns plain data
//. Not a Server Component and not an action: `Screen.tsx` calls it, the tests call it directly.
//
// Reads: listImportMappings, listImportJobs, listDataQualityIssues (the newest page, plus every listed issue of the job shown),
// listCases (only its total: "Cases held"), getCase and listZones (the facts of the case behind an issue).

import { getCase, listCases } from '@/lib/data/cases';
import { isOidcMode } from '@/lib/data/context';
import { ForbiddenError, NotFoundError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listImportJobs, listDataQualityIssues, listImportMappings } from '@/lib/data/imports';
import { listZones } from '@/lib/data/locations';
import type { DataSource, DataQualityIssue, ImportJob, Zone } from '@/lib/types';
import type { CaseFacts, ImportView, IssueDetail, IssueRow, IssueStatus, IssueType, JobRow, MappingView, Severity } from './types';
import { stepViewOf } from './importSteps';

const PAGE = 200;
// A job lists at most 100 issues per kind plus summaries.
const JOB_PAGES = 25;

/** What the address bar may ask for (already validated by parseSearchParams). */
/** @pure The download's name, from the label. */
export function mappingFileName(mapping: MappingView | null): string {
  const slug = (mapping?.label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'mapping.csv' : `${slug}-mapping.csv`;
}

export interface ImportQuery {
  readonly job?: string | undefined;
  readonly severity?: Severity | undefined;
  readonly status?: IssueStatus | undefined;
  readonly type?: IssueType | undefined;
  readonly q?: string | undefined;
  readonly issue?: string | undefined;
}

async function tryOrAsync<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return fallback;
    throw error;
  }
}

const zoneCode = (zone: Zone): string => {
  const code = zone.extra?.['code'];
  return typeof code === 'string' && code !== '' ? code : zone.name_en;
};

function jobRow(job: ImportJob, issues: readonly DataQualityIssue[], labels: ReadonlyMap<string, string>): JobRow {
  const own = issues.filter((i) => i.import_job_id === job.id);
  const errors = job.error_count ?? 0;
  const warnings = job.warning_count ?? 0;
  return {
    id: job.id,
    file: job.file_name,
    status: job.status,
    rows: job.row_count,
    issues: job.issue_count,
    errors,
    warnings,
    info: Math.max(0, job.issue_count - errors - warnings),
    blocking: own.filter((i) => i.severity === 'error' && (i.status === 'open' || i.status === 'acknowledged')).length,
    mappingVersion: job.mapping_version,
    stored: job.storage_ref !== null && job.storage_ref !== undefined,
    mappingLabel: labels.get(job.mapping_version) ?? job.mapping_version,
    validatedAt: job.validated_at ?? null,
    cutOverAt: job.cut_over_at ?? null,
    step: stepViewOf(job),
  };
}

async function jobIssues(ctx: RequestContext, jobId: string): Promise<DataQualityIssue[]> {
  const out: DataQualityIssue[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < JOB_PAGES; i += 1) {
    const page = await listDataQualityIssues(ctx, { import_job_id: jobId, limit: PAGE, cursor });
    out.push(...page.items);
    if (!page.page.has_more || page.page.next_cursor === null || page.page.next_cursor === undefined) break;
    cursor = page.page.next_cursor;
  }
  return out;
}

function mergeById(a: readonly DataQualityIssue[], b: readonly DataQualityIssue[]): DataQualityIssue[] {
  const seen = new Set(a.map((i) => i.id));
  return [...a, ...b.filter((i) => !seen.has(i.id))];
}

/** The text the search box looks in: the type, the message, the field and the row, as the mockup does. */
const searchable = (issue: IssueRow): string => `${issue.type} ${issue.message} ${issue.field ?? ''} ${issue.row ?? ''}`.toLowerCase();

export async function loadImportView(ctx: RequestContext, query: ImportQuery, rawJob?: string | undefined, rawIssue?: string | undefined): Promise<ImportView> {
  const mappings = (await listImportMappings(ctx, { limit: PAGE })).items;
  const rawJobs = (await listImportJobs(ctx, { limit: PAGE })).items;
  const firstPage = await listDataQualityIssues(ctx, { limit: PAGE });
  const shownJob = (query.job !== undefined && rawJobs.some((j) => j.id === query.job) ? query.job : undefined) ?? rawJobs[0]?.id;
  const rawIssues = shownJob === undefined ? firstPage.items : mergeById(firstPage.items, await jobIssues(ctx, shownJob));

  const labels = new Map(mappings.map((m) => [m.version, m.name_en] as const));
  const jobs = rawJobs.map((job) => jobRow(job, rawIssues, labels));
  const fileOf = new Map(jobs.map((job) => [job.id, job.file] as const));
  const all: IssueRow[] = rawIssues.map((i) => ({
    id: i.id,
    jobId: i.import_job_id ?? null,
    jobFile: i.import_job_id === null || i.import_job_id === undefined ? '' : (fileOf.get(i.import_job_id) ?? ''),
    severity: i.severity,
    status: i.status,
    type: i.issue_type,
    message: i.message,
    row: i.row_number ?? null,
    field: i.field ?? null,
  }));

  const wanted = query.q?.toLowerCase();
  // `?job=` narrows the list to that import's issues (the Import tab's "View issues" sets it); a job that is not there filters nothing.
  const scoped = query.job !== undefined && jobs.some((j) => j.id === query.job) ? query.job : undefined;
  const issues = all.filter((i) => (scoped === undefined || i.jobId === scoped) && (query.severity === undefined || i.severity === query.severity) && (query.status === undefined || i.status === query.status) && (query.type === undefined || i.type === query.type) && (wanted === undefined || searchable(i).includes(wanted)));

  const current = (query.job === undefined ? undefined : jobs.find((j) => j.id === query.job)) ?? jobs[0] ?? null;
  const target = query.issue === undefined ? undefined : rawIssues.find((i) => i.id === query.issue);
  let open: IssueDetail | undefined;
  if (target !== undefined) {
    const row = all.find((i) => i.id === target.id) as IssueRow;
    let caseFacts: CaseFacts | null = null;
    const caseId = target.case_id ?? null;
    if (caseId !== null) {
      const found = await tryOrAsync(() => getCase(ctx, caseId), undefined);
      if (found !== undefined) {
        const zones = await tryOrAsync(async () => (await listZones(ctx, { limit: PAGE })).items, []);
        caseFacts = { number: found.case_number, zone: zones.flatMap((z) => (z.id === found.zone_id ? [zoneCode(z)] : []))[0] ?? '', registeredAt: found.registered_at, assignedAt: found.assigned_at ?? null, parties: found.parties_involved, handling: found.handling };
      }
    }
    open = { ...row, caseFacts };
  }

  const m = mappings.find((x) => x.version === current?.mappingVersion) ?? mappings[0];
  const mapping: MappingView | null =
    m === undefined ? null : { version: m.version, label: m.name_en, format: m.source_format, requiredColumns: m.columns.filter((c) => c.required).length, columns: m.columns.map((c) => ({ source: c.source_column, internal: c.internal_field, required: c.required })) };

  const held = await tryOrAsync(async () => (await listCases(ctx, { limit: 1 })).page.total ?? null, null);
  const sources = [...new Set<DataSource>([...rawJobs.map((j) => j.data_source), ...rawIssues.map((i) => i.data_source)])];
  return {
    mapping,
    jobs,
    current,
    issues,
    issuesTotal: all.length,
    open,
    unknownIssue: rawIssue !== undefined && rawIssue !== '' && open === undefined,
    unknownJob: rawJob !== undefined && rawJob !== '' && current !== null && !jobs.some((j) => j.id === rawJob),
    held,
    sources,
    demo: !isOidcMode(),
  };
}
