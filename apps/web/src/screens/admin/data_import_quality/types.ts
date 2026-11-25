// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Data Import and Quality screen: what the server side hands to the client
// files. JSON-safe (strings, numbers, booleans, arrays and objects of those). Nothing here is a context, a customer or the
// caller's role.

import type { DataSource } from '@/lib/types';
import type { StepView } from './importSteps';

export const TABS = ['import', 'issues', 'jobs'] as const;
export type ImportTabName = (typeof TABS)[number];

export type JobStatus = 'uploaded' | 'validating' | 'validated' | 'compared' | 'dry_run_done' | 'cut_over' | 'failed' | 'rolled_back';
export type Severity = 'error' | 'warning' | 'info';
export type IssueStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored';
export type IssueType = 'assigned_before_registered' | 'unusual_parties_count' | 'missing_required_field' | 'unknown_reference' | 'duplicate_external_id' | 'out_of_range_coordinate' | 'inconsistent_name_case' | 'other';

export const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];
export const ISSUE_STATUSES: readonly IssueStatus[] = ['open', 'acknowledged', 'resolved', 'ignored'];
export const ISSUE_TYPES: readonly IssueType[] = ['assigned_before_registered', 'unusual_parties_count', 'missing_required_field', 'unknown_reference', 'duplicate_external_id', 'out_of_range_coordinate', 'inconsistent_name_case', 'other'];

export interface JobRow {
  readonly id: string;
  readonly file: string;
  readonly status: JobStatus;
  readonly rows: number;
  readonly issues: number;
  readonly errors: number;
  readonly warnings: number;
  readonly info: number;
  /** Error issues that are still open or acknowledged: they block the cut-over. */
  readonly blocking: number;
  readonly mappingVersion: string;
  /** The file is in object storage (fixture jobs have none). */
  readonly stored: boolean;
  /** The mapping's display name, else its id. */
  readonly mappingLabel: string;
  readonly validatedAt: string | null;
  readonly cutOverAt: string | null;
  /** The last background step, if any. */
  readonly step?: StepView | undefined;
}

export interface IssueRow {
  readonly id: string;
  readonly jobId: string | null;
  readonly jobFile: string;
  readonly severity: Severity;
  readonly status: IssueStatus;
  readonly type: IssueType;
  /** The data layer's English line for the issue. */
  readonly message: string;
  readonly row: number | null;
  readonly field: string | null;
}

export interface CaseFacts {
  readonly number: string;
  readonly zone: string;
  readonly registeredAt: string;
  readonly assignedAt: string | null;
  readonly parties: number;
  /** `field` or `remote_inferred`. */
  readonly handling: string;
}

export interface IssueDetail extends IssueRow {
  readonly caseFacts: CaseFacts | null;
}

export interface MappingView {
  readonly version: string;
  /** Display name (name_en): shown, not the id. */
  readonly label: string;
  readonly format: 'csv' | 'xlsx';
  readonly requiredColumns: number;
  readonly columns: readonly { readonly source: string; readonly internal: string; readonly required: boolean }[];
}

export interface ImportView {
  readonly mapping: MappingView | null;
  readonly jobs: readonly JobRow[];
  /** The job the Import tab shows (`?job=`, else the newest). */
  readonly current: JobRow | null;
  /** The issues matching the filters, over every job. */
  readonly issues: readonly IssueRow[];
  /** Every issue, whatever the filters (the tab's count). */
  readonly issuesTotal: number;
  readonly open: IssueDetail | undefined;
  /** `?issue=` or `?job=` named something that is not there: the screen says so above the content. */
  readonly unknownIssue: boolean;
  readonly unknownJob: boolean;
  /** A demo install: uploads default to Synthetic. */
  readonly demo: boolean;
  /** Cases already held, or null when the caller may not read them. */
  readonly held: number | null;
  readonly sources: readonly DataSource[];
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). No field here is a context, customer, user, role, zone scope or install
// mode. A job is a `jobId`, an issue an `issueId`; the file is the text the browser read with File.text().
// ---------------------------------------------------------------------------------------------

export interface UploadInput {
  readonly file_name: string;
  /** The text of the CSV file. At most 8,000,000 characters (the data layer's limit). */
  readonly file: string;
  readonly mapping_version: string;
  /** The label the job and its cases carry. */
  readonly data_source?: UploadSource;
}

/** A screen upload's label; never LIVE. */
export type UploadSource = 'IMPORTED' | 'SYNTHETIC';
export const UPLOAD_SOURCES: readonly UploadSource[] = ['IMPORTED', 'SYNTHETIC'];

export interface JobTarget {
  readonly jobId: string;
}

export interface IssueChange {
  readonly issueId: string;
  readonly status: string;
  readonly note: string;
}

export interface UploadOutcome {
  readonly jobId: string;
  readonly file: string;
  readonly rows: number;
}

export interface ValidateOutcome {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly errors: number;
  readonly warnings: number;
}

export interface CompareOutcome {
  readonly jobId: string;
  readonly existing: number;
  readonly incoming: number;
  readonly added: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly missing: number;
}

export interface DryRunOutcome {
  readonly jobId: string;
  /** Errors that block the cut-over; the job stays `compared` while there are any. */
  readonly blocking: number;
  readonly wouldInsert: number;
  readonly wouldUpdate: number;
  readonly wouldSkip: number;
}

export interface CutOverOutcome {
  readonly jobId: string;
  readonly inserted: number;
  readonly updated: number;
}

export interface RollbackOutcome {
  readonly jobId: string;
  readonly deleted: number;
  readonly restored: number;
}

export interface IssueOutcome {
  readonly issueId: string;
  readonly status: IssueStatus;
  readonly type: IssueType;
}

// ---- Import help (assistant ----

/** The assistant features this screen may show. */
export interface ImportHelp {
  readonly configured: boolean;
  readonly mapping: boolean;
  readonly issues: boolean;
}

export interface HelpTarget {
  readonly jobId: string;
  readonly locale: string;
}

export interface MetaView {
  readonly provider: string;
  readonly model: string;
  readonly duration_ms: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface SuggestedColumn {
  readonly source: string;
  readonly field: string | null;
  readonly confidence: Confidence;
  readonly reason: string;
  readonly exact: boolean;
}

export interface MappingSuggestionView extends MetaView {
  readonly baseVersion: string;
  readonly columns: readonly SuggestedColumn[];
  readonly fields: readonly { readonly field: string; readonly column: string; readonly required: boolean }[];
  /** Versions already taken (file and saved). */
  readonly versions: readonly string[];
  readonly sent: string;
}

export interface IssuesHelpView extends MetaView {
  readonly text: string;
  readonly fixes: readonly string[];
  readonly ownerNote: string;
  readonly rules: readonly string[];
  readonly fallback: boolean;
  readonly sent: string;
}

export interface SaveMappingInput {
  /** Set: that import switches to the new version. */
  readonly jobId?: string | undefined;
  readonly version: string;
  readonly baseVersion: string;
  readonly notes: string;
  readonly columns: readonly { readonly source_column: string; readonly internal_field: string }[];
  readonly assisted: boolean;
}

export interface SaveMappingOutcome {
  readonly version: string;
  readonly applied: boolean;
}
