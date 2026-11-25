// SPDX-License-Identifier: AGPL-3.0-only
// Background steps: the job's step as the screen sees it.

import type { CutoverResult, ImportComparison, ImportJob, ImportRollbackResult } from '@/lib/types';
import type { CompareOutcome, CutOverOutcome, DryRunOutcome, JobStatus, RollbackOutcome, ValidateOutcome } from './types';

export const STEP_NAMES = ['validate', 'compare', 'dry_run', 'cut_over', 'rollback'] as const;
export type StepName = (typeof STEP_NAMES)[number];
export type StepState = 'running' | 'succeeded' | 'failed';

export type StepOutcome =
  | { readonly kind: 'validate'; readonly value: ValidateOutcome }
  | { readonly kind: 'compare'; readonly value: CompareOutcome }
  | { readonly kind: 'dry_run'; readonly value: DryRunOutcome }
  | { readonly kind: 'cut_over'; readonly value: CutOverOutcome }
  | { readonly kind: 'rollback'; readonly value: RollbackOutcome };

export interface StepView {
  readonly jobId: string;
  readonly step: StepName | null;
  readonly state: StepState | null;
  readonly done: number;
  readonly total: number | null;
  readonly error: string | null;
  readonly status: JobStatus;
  readonly outcome: StepOutcome | null;
}

export interface StepTarget {
  readonly jobId: string;
  readonly step: StepName;
}

/** The message key of a step's name. */
export const STEP_LABEL: Readonly<Record<StepName, string>> = { validate: 'step.validate', compare: 'step.compare', dry_run: 'step.dryrun', cut_over: 'step.cutover', rollback: 'act.rollback' };

function outcomeOf(job: ImportJob, step: StepName): StepOutcome | null {
  const r = job.step_result as unknown;
  const id = job.id;
  if (step === 'validate') return { kind: 'validate', value: { jobId: id, status: job.status, errors: job.error_count ?? 0, warnings: job.warning_count ?? 0 } };
  if (r === null || r === undefined || typeof r !== 'object') return null;
  if (step === 'compare') {
    const c = r as ImportComparison;
    return { kind: 'compare', value: { jobId: id, existing: c.existing_case_count, incoming: c.incoming_case_count, added: c.new_count, changed: c.changed_count, unchanged: c.unchanged_count, missing: c.missing_from_import_count } };
  }
  if (step === 'rollback') {
    const b = r as ImportRollbackResult;
    return { kind: 'rollback', value: { jobId: id, deleted: b.deleted_count, restored: b.restored_count } };
  }
  const x = r as CutoverResult;
  if (step === 'dry_run') return { kind: 'dry_run', value: { jobId: id, blocking: x.blocking_issue_count, wouldInsert: x.would_insert, wouldUpdate: x.would_update, wouldSkip: x.would_skip } };
  return { kind: 'cut_over', value: { jobId: id, inserted: x.would_insert, updated: x.would_update } };
}

/** The job's last step, plain for the browser. */
export function stepViewOf(job: ImportJob): StepView {
  const step = (STEP_NAMES as readonly string[]).includes(job.step ?? '') ? (job.step as StepName) : null;
  const state = job.step_state ?? null;
  return {
    jobId: job.id,
    step,
    state,
    done: job.step_rows_done ?? 0,
    total: job.step_rows_total ?? null,
    error: job.step_error ?? null,
    status: job.status,
    outcome: step !== null && state === 'succeeded' ? outcomeOf(job, step) : null,
  };
}
