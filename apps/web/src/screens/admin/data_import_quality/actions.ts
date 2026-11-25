'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Data Import and Quality screen: exactly the data functions of
// lib/data/imports.ts.
//
//   uploadImportFile   uploadImport             (the CSV text and its name; a .xlsx is refused: CSV only, at most 8,000,000 characters)
//   startUpload        createImportUpload       (a file up to 1 GB: its name, size, mapping and source; the chunks go to the route)
//   finishUpload       completeImportUpload     (joins the chunks; the job is uploaded)
//   cancelUpload       cancelImportUpload       (removes the chunks received)
//   startStep          startImportStep          (a step in the background: validate, compare, dry_run, cut_over, rollback)
//   stepProgress       getImportJob             (the step's rows done and outcome, polled)
//   validateJob        validateImport           (reads the parsed CSV against the mapping: scripted, deterministic, offline)
//   compareJob         compareImport            (counts against the cases already held)
//   dryRunJob          dryRunCutover            (changes nothing but the job's status; errors that are open or acknowledged block)
//   cutOverJob         executeCutover           (the job's data source)
//   rollBackJob        rollbackImport           (administrator only)
//   setIssueStatus     updateDataQualityIssue   (open, acknowledged, resolved, ignored, with an optional note)
//   suggestMapping     suggestImportMappingWithAssistant  (a suggestion only; nothing saved)
//   explainIssues      explainImportIssuesWithAssistant   (reads only)
//   saveMapping        createImportMapping      (a person saves a new version; audited)
//
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. A job is a
// `jobId`, an issue an `issueId`. (tools/rules/context-rules.test.ts scans this file for those names.) The upload is the second
// of two checks on the file: the drop area refuses the wrong type and size in the browser, and the data layer refuses them again.

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { explainImportIssuesWithAssistant, suggestImportMappingWithAssistant } from '@/lib/data/assistant';
import { cancelImportUpload, completeImportUpload, createImportUpload, startImportStep } from '@/lib/data/import-uploads';
import { compareImport, createImportMapping, dryRunCutover, executeCutover, getImportJob, listImportMappings, rollbackImport, updateDataQualityIssue, uploadImport, validateImport } from '@/lib/data/imports';
import type { StartedUpload, StartUploadInput, UploadTarget } from './chunkedUpload';
import { stepViewOf, type StepTarget, type StepView } from './importSteps';
import type { HelpTarget, IssuesHelpView, MappingSuggestionView, SaveMappingInput, SaveMappingOutcome, CompareOutcome, CutOverOutcome, DryRunOutcome, IssueChange, IssueOutcome, JobTarget, RollbackOutcome, UploadInput, UploadOutcome, ValidateOutcome } from './types';

const REVALIDATE = '/admin/data-import-quality';
const jobOf = (input: unknown): string => pickText(input, 'jobId') ?? '';

/** Takes the CSV as text with its name and the mapping version. The job is stored as `uploaded`; validate it next. */
export async function uploadImportFile(input: UploadInput): Promise<ActionResult<UploadOutcome>> {
  return runAction(
    async (ctx) => {
      const job = await uploadImport(ctx, pickFields(input, ['file_name', 'file', 'mapping_version', 'data_source']));
      return { jobId: job.id, file: job.file_name, rows: job.row_count } satisfies UploadOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

export async function validateJob(input: JobTarget): Promise<ActionResult<ValidateOutcome>> {
  return runAction(
    async (ctx) => {
      const job = await validateImport(ctx, jobOf(input));
      return { jobId: job.id, status: job.status, errors: job.error_count ?? 0, warnings: job.warning_count ?? 0 } satisfies ValidateOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

export async function compareJob(input: JobTarget): Promise<ActionResult<CompareOutcome>> {
  return runAction(
    async (ctx) => {
      const jobId = jobOf(input);
      const r = await compareImport(ctx, jobId);
      return { jobId, existing: r.existing_case_count, incoming: r.incoming_case_count, added: r.new_count, changed: r.changed_count, unchanged: r.unchanged_count, missing: r.missing_from_import_count } satisfies CompareOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

export async function dryRunJob(input: JobTarget): Promise<ActionResult<DryRunOutcome>> {
  return runAction(
    async (ctx) => {
      const jobId = jobOf(input);
      const r = await dryRunCutover(ctx, jobId);
      return { jobId, blocking: r.blocking_issue_count, wouldInsert: r.would_insert, wouldUpdate: r.would_update, wouldSkip: r.would_skip } satisfies DryRunOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

/** The real cut-over: writes the cases of the file with the job's data source. Only after a dry run that passed. */
export async function cutOverJob(input: JobTarget): Promise<ActionResult<CutOverOutcome>> {
  return runAction(
    async (ctx) => {
      const jobId = jobOf(input);
      const r = await executeCutover(ctx, jobId);
      return { jobId, inserted: r.would_insert, updated: r.would_update } satisfies CutOverOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

/** Administrator only: undoes a cut-over (cases it added go, cases it changed get their earlier values back). */
export async function rollBackJob(input: JobTarget): Promise<ActionResult<RollbackOutcome>> {
  return runAction(
    async (ctx) => {
      const jobId = jobOf(input);
      const r = await rollbackImport(ctx, jobId);
      return { jobId, deleted: r.deleted_count, restored: r.restored_count } satisfies RollbackOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

/** Sets the status of one data quality issue, with an optional note of at most 500 characters. */
export async function setIssueStatus(input: IssueChange): Promise<ActionResult<IssueOutcome>> {
  return runAction(
    async (ctx) => {
      const issueId = pickText(input, 'issueId') ?? '';
      const note = (pickText(input, 'note') ?? '').trim();
      const issue = await updateDataQualityIssue(ctx, issueId, { status: pickText(input, 'status'), note: note === '' ? null : note });
      return { issueId, status: issue.status, type: issue.issue_type } satisfies IssueOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

const helpBody = (input: unknown) => ({ import_id: jobOf(input), locale: pickText(input, 'locale') === 'ar' ? 'ar' : 'en' });

/** A mapping suggestion for a job whose header does not match; nothing is saved. */
export async function suggestMapping(input: HelpTarget): Promise<ActionResult<MappingSuggestionView>> {
  return runAction(async (ctx) => {
    const s = await suggestImportMappingWithAssistant(ctx, helpBody(input));
    const versions = (await listImportMappings(ctx, { limit: 200 })).items.map((m) => m.version);
    return {
      provider: s.provider,
      model: s.model,
      duration_ms: s.duration_ms,
      baseVersion: s.base_version,
      columns: s.columns.map((c) => ({ source: c.source_column, field: c.internal_field ?? null, confidence: c.confidence, reason: c.reason, exact: c.matched_by === 'exact' })),
      fields: s.fields.map((f) => ({ field: f.internal_field, column: f.mapped_column, required: f.required })),
      versions,
      sent: s.sent,
    } satisfies MappingSuggestionView;
  });
}

/** A summary, fixes, a note and a rules draft for a job's issues. */
export async function explainIssues(input: HelpTarget): Promise<ActionResult<IssuesHelpView>> {
  return runAction(async (ctx) => {
    const r = await explainImportIssuesWithAssistant(ctx, helpBody(input));
    return { provider: r.provider, model: r.model, duration_ms: r.duration_ms, text: r.text, fixes: r.fixes, ownerNote: r.owner_note, rules: r.cleaning_rules, fallback: r.fallback, sent: r.sent } satisfies IssuesHelpView;
  });
}

/** Saves a new mapping version; with a job, that import uses it. */
export async function saveMapping(input: SaveMappingInput): Promise<ActionResult<SaveMappingOutcome>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['version', 'baseVersion', 'notes', 'columns', 'assisted']);
      const jobId = pickText(input, 'jobId');
      const notes = typeof fields.notes === 'string' ? fields.notes.trim() : '';
      const columns = Array.isArray(fields.columns) ? fields.columns.map((c: unknown) => pickFields(c, ['source_column', 'internal_field'])) : fields.columns;
      const body: Record<string, unknown> = { version: fields.version, base_version: fields.baseVersion, notes: notes === '' ? null : notes, columns, assisted: fields.assisted === true };
      if (jobId !== undefined && jobId !== '') body['apply_to_import_id'] = jobId;
      const saved = await createImportMapping(ctx, body);
      return { version: saved.version, applied: body['apply_to_import_id'] !== undefined } satisfies SaveMappingOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

const uploadOf = (input: unknown): string => pickText(input, 'uploadId') ?? '';

/** Name, size, mapping, source; chunks follow. */
export async function startUpload(input: StartUploadInput): Promise<ActionResult<StartedUpload>> {
  return runAction(async (ctx) => {
    const s = await createImportUpload(ctx, pickFields(input, ['file_name', 'size', 'mapping_version', 'data_source']));
    return { uploadId: s.id, chunkSize: s.chunk_size, chunkCount: s.chunk_count, received: s.received_chunks } satisfies StartedUpload;
  });
}

/** Joins the chunks; the job is `uploaded`. */
export async function finishUpload(input: UploadTarget): Promise<ActionResult<UploadOutcome>> {
  return runAction(
    async (ctx) => {
      const job = await completeImportUpload(ctx, uploadOf(input));
      return { jobId: job.id, file: job.file_name, rows: job.row_count } satisfies UploadOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

/** Removes the chunks received so far. */
export async function cancelUpload(input: UploadTarget): Promise<ActionResult<null>> {
  return runAction(async (ctx) => {
    await cancelImportUpload(ctx, uploadOf(input));
    return null;
  });
}

/** Starts a step; it runs on in the api. */
export async function startStep(input: StepTarget): Promise<ActionResult<StepView>> {
  return runAction(async (ctx) => stepViewOf(await startImportStep(ctx, jobOf(input), { step: pickText(input, 'step') })));
}

/** The job's step now (polled every 2 s). */
export async function stepProgress(input: JobTarget): Promise<ActionResult<StepView>> {
  return runAction(async (ctx) => stepViewOf(await getImportJob(ctx, jobOf(input))));
}
