// SPDX-License-Identifier: AGPL-3.0-only
// Data import and quality: thin Go client.

import type {
  CutoverResult,
  DataQualityIssue,
  DataQualityIssueList,
  ImportComparison,
  ImportJob,
  ImportJobList,
  ImportMappingInfo,
  ImportMappingInfoList,
  ImportRollbackResult,
} from '@/lib/types';
import { requireFound, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';
import { customerText } from './wording';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: listImportMappings
export async function listImportMappings(ctx: RequestContext, query: PageQuery = {}): Promise<ImportMappingInfoList> {
  return (await businessFetch<ImportMappingInfoList>(ctx, `/imports/mappings${qs({ limit: query.limit, cursor: query.cursor })}`))!;
}

// operationId: createImportMapping
export async function createImportMapping(ctx: RequestContext, body: unknown): Promise<ImportMappingInfo> {
  return (await businessFetch<ImportMappingInfo>(ctx, '/imports/mappings', { method: 'POST', body }))!;
}

// operationId: listImportJobs
export async function listImportJobs(ctx: RequestContext, query: PageQuery = {}): Promise<ImportJobList> {
  return (await businessFetch<ImportJobList>(ctx, `/imports${qs({ limit: query.limit, cursor: query.cursor })}`))!;
}

// operationId: getImportJob
export async function getImportJob(ctx: RequestContext, id: string): Promise<ImportJob> {
  return requireFound(await businessFetch<ImportJob>(ctx, `/imports/${idSegment(id)}`), 'Import job');
}

// Messages name the install's customer
const neutralIssues = (list: DataQualityIssueList): DataQualityIssueList => ({ ...list, items: list.items.map((i) => ({ ...i, message: customerText(i.message) })) });

// operationId: listDataQualityIssues
export async function listDataQualityIssues(
  ctx: RequestContext,
  query: PageQuery & { readonly status?: DataQualityIssue['status'] | undefined; readonly severity?: DataQualityIssue['severity'] | undefined; readonly import_job_id?: string | undefined } = {},
): Promise<DataQualityIssueList> {
  return neutralIssues((await businessFetch<DataQualityIssueList>(ctx, `/data-quality/issues${qs({ limit: query.limit, cursor: query.cursor, status: query.status, severity: query.severity, import_job_id: query.import_job_id })}`))!);
}

// operationId: listImportIssues
export async function listImportIssues(ctx: RequestContext, id: string, query: PageQuery = {}): Promise<DataQualityIssueList> {
  return neutralIssues(requireFound(await businessFetch<DataQualityIssueList>(ctx, `/imports/${idSegment(id)}/issues${qs({ limit: query.limit, cursor: query.cursor })}`), 'Import job'));
}

// operationId: updateDataQualityIssue
export async function updateDataQualityIssue(ctx: RequestContext, id: string, body: unknown): Promise<DataQualityIssue> {
  return (await businessFetch<DataQualityIssue>(ctx, `/data-quality/issues/${idSegment(id)}`, { method: 'PUT', body }))!;
}

/** Takes the file as text (`file`) and its name (`file_name`). Stores the job as `uploaded`; validate it next. */
// operationId: uploadImport
export async function uploadImport(ctx: RequestContext, body: unknown): Promise<ImportJob> {
  return (await businessFetch<ImportJob>(ctx, '/imports', { method: 'POST', body }))!;
}

// operationId: validateImport
export async function validateImport(ctx: RequestContext, id: string): Promise<ImportJob> {
  return (await businessFetch<ImportJob>(ctx, `/imports/${idSegment(id)}/validate`, { method: 'POST' }))!;
}

// operationId: compareImport
export async function compareImport(ctx: RequestContext, id: string): Promise<ImportComparison> {
  return (await businessFetch<ImportComparison>(ctx, `/imports/${idSegment(id)}/compare`, { method: 'POST' }))!;
}

/** Changes nothing but the job's own status (to `dry_run_done` when nothing blocks the real cut-over). */
// operationId: dryRunCutover
export async function dryRunCutover(ctx: RequestContext, id: string): Promise<CutoverResult> {
  return (await businessFetch<CutoverResult>(ctx, `/imports/${idSegment(id)}/cutover/dry-run`, { method: 'POST' }))!;
}

// operationId: executeCutover
export async function executeCutover(ctx: RequestContext, id: string): Promise<CutoverResult> {
  return (await businessFetch<CutoverResult>(ctx, `/imports/${idSegment(id)}/cutover`, { method: 'POST' }))!;
}

/** Administrator only: removes the cases the cut-over added and restores the ones it changed. */
// operationId: rollbackImport
export async function rollbackImport(ctx: RequestContext, id: string): Promise<ImportRollbackResult> {
  return (await businessFetch<ImportRollbackResult>(ctx, `/imports/${idSegment(id)}/rollback`, { method: 'POST' }))!;
}
