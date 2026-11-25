// SPDX-License-Identifier: AGPL-3.0-only
// Admin fixtures: import jobs, data-quality issues, notifications and seeded audit events. Node-free.

import { base, idOf, type Ctx, type Rec } from './context';
import type { PlannedCase } from './dayplan';
import { userByKey, type UserFx, ruleVersionId, RULE_DEFS } from './build-reference';
import { iso, parseIso } from './time';

export interface ImportFx {
  readonly jobs: Rec[];
  readonly issues: Rec[];
}

/**
 * The week's cases came in through one import. Its issues are the two the data model observations that are real in the data:
 * cases assigned before they were registered, and cases with zero or one party. A second, partial file is validated and
 * waiting, and a third failed on its header.
 */
export function buildImports(ctx: Ctx, users: readonly UserFx[], weekCases: readonly PlannedCase[]): ImportFx {
  const admin = userByKey(users, 'administrator').id;
  const weekJob = idOf(ctx, 'import_job', 'week');
  const partialJob = idOf(ctx, 'import_job', 'partial');
  const failedJob = idOf(ctx, 'import_job', 'failed');
  const issues: Rec[] = [];
  const perJob = new Map<string, { errors: number; warnings: number; infos: number }>();
  const tally = (job: string, severity: string): void => {
    const t = perJob.get(job) ?? { errors: 0, warnings: 0, infos: 0 };
    if (severity === 'error') t.errors += 1;
    else if (severity === 'warning') t.warnings += 1;
    else t.infos += 1;
    perJob.set(job, t);
  };
  const importedAt = parseIso('2026-09-05T21:30:00+03:00');

  const push = (job: string, key: string, at: number, fields: { caseId?: string | null; row?: number | null; field?: string | null; type: string; severity: string; status: string; message: string }): void => {
    tally(job, fields.severity);
    issues.push({
      ...base(ctx, 'data_quality_issue', key, at, at, admin),
      import_job_id: job,
      case_id: fields.caseId ?? null,
      row_number: fields.row ?? null,
      field: fields.field ?? null,
      issue_type: fields.type,
      severity: fields.severity,
      status: fields.status,
      message: fields.message,
    });
  };

  weekCases.forEach((c, i) => {
    const row = i + 1;
    if (c.assigned_before_registration && c.assigned !== null) {
      const minutes = Math.max(1, Math.round((c.registered - c.assigned) / 60));
      push(weekJob, `${c.case_number}|assigned_before_registered`, importedAt, {
        caseId: c.id,
        row,
        field: 'assigned_at',
        type: 'assigned_before_registered',
        severity: 'warning',
        status: 'acknowledged',
        message: `Assigned ${minutes} minute${minutes === 1 ? '' : 's'} before it was registered (Unlisted case).`,
      });
    }
    if (c.parties <= 1) {
      push(weekJob, `${c.case_number}|unusual_parties`, importedAt, {
        caseId: c.id,
        row,
        field: 'parties_involved',
        type: 'unusual_parties_count',
        severity: 'warning',
        status: 'open',
        message: `${c.parties} parties involved. Meaning to be confirmed by the operator.`,
      });
    }
  });
  // A few naming findings that do not belong to one case.
  ['riyadh', 'JEDDAH', 'dammam', 'Riyadh ', 'JEDDAH', 'Dammam'].forEach((v, i) => {
    push(weekJob, `name_case|${i}`, importedAt, { row: 900 + i * 1700, field: 'CityNameEn', type: 'inconsistent_name_case', severity: 'info', status: 'ignored', message: `City name "${v.trim()}" has inconsistent capitals; joined on CityID instead.` });
  });

  const partialAt = parseIso('2026-09-12T18:10:00+03:00');
  push(partialJob, 'partial|1', partialAt, { row: 118, field: 'RegisteredTime', type: 'missing_required_field', severity: 'error', status: 'open', message: 'Registration time is empty.' });
  push(partialJob, 'partial|2', partialAt, { row: 402, field: 'ZoneID', type: 'unknown_reference', severity: 'error', status: 'open', message: 'ZoneID 2099 is not in the locations.' });
  push(partialJob, 'partial|3', partialAt, { row: 455, field: 'Latitude', type: 'out_of_range_coordinate', severity: 'error', status: 'open', message: 'Latitude 91.2 is outside -90 to 90.' });
  push(partialJob, 'partial|4', partialAt, { row: 511, field: 'RecordID', type: 'duplicate_external_id', severity: 'warning', status: 'open', message: 'RecordID appears twice in the file.' });
  const failedAt = parseIso('2026-09-11T11:00:00+03:00');
  push(failedJob, 'failed|1', failedAt, { row: null, field: 'CaseNumber', type: 'missing_required_field', severity: 'error', status: 'open', message: 'Column CaseNumber is missing from the header row.' });

  const weekTally = perJob.get(weekJob) ?? { errors: 0, warnings: 0, infos: 0 };
  const partialTally = perJob.get(partialJob) ?? { errors: 0, warnings: 0, infos: 0 };
  const failedTally = perJob.get(failedJob) ?? { errors: 0, warnings: 0, infos: 0 };
  const total = (t: { errors: number; warnings: number; infos: number }): number => t.errors + t.warnings + t.infos;

  const jobs: Rec[] = [
    {
      ...base(ctx, 'import_job', 'week', importedAt, importedAt + 900, admin),
      file_name: 'synthetic_cases_2026-09-06_to_2026-09-12.csv',
      mapping_version: 'generic_csv_v1',
      status: 'cut_over',
      row_count: weekCases.length,
      issue_count: total(weekTally),
      error_count: weekTally.errors,
      warning_count: weekTally.warnings,
      storage_ref: null,
      validated_at: iso(importedAt + 300),
      cut_over_at: iso(importedAt + 900),
    },
    {
      ...base(ctx, 'import_job', 'partial', partialAt - 600, partialAt, admin),
      file_name: 'synthetic_extract_2026-09-13_partial.csv',
      mapping_version: 'generic_csv_v1',
      status: 'validated',
      row_count: 640,
      issue_count: total(partialTally),
      error_count: partialTally.errors,
      warning_count: partialTally.warnings,
      storage_ref: null,
      validated_at: iso(partialAt),
      cut_over_at: null,
    },
    {
      ...base(ctx, 'import_job', 'failed', failedAt - 300, failedAt, admin),
      file_name: 'synthetic_bad_header.csv',
      mapping_version: 'generic_csv_v1',
      status: 'failed',
      row_count: 0,
      issue_count: total(failedTally),
      error_count: failedTally.errors,
      warning_count: failedTally.warnings,
      storage_ref: null,
      validated_at: null,
      cut_over_at: null,
    },
  ];
  return { jobs, issues };
}

export function buildNotifications(ctx: Ctx, users: readonly UserFx[]): Rec[] {
  const uid = (key: string): string => userByKey(users, key).id;
  const t = (h: number, m: number): number => parseIso('2026-09-12T00:00:00+03:00') + h * 3600 + m * 60;
  const defs: { key: string; user: string | null; role: string | null; category: string; severity: string; title: string; body: string | null; link: string | null; read: boolean; at: number }[] = [
    { key: 'n1', user: null, role: 'dispatch_supervisor', category: 'roster', severity: 'info', title: 'Roster waiting for approval', body: 'Riyadh Central, Monday 14 September.', link: '/ops/field-planner', read: false, at: t(20, 5) },
    { key: 'n2', user: null, role: 'administrator', category: 'integration', severity: 'warning', title: 'Agent feed is degraded', body: 'Position updates are delayed for 4 agents.', link: '/admin/data-sources', read: false, at: t(23, 40) },
    { key: 'n3', user: uid('planner'), role: null, category: 'leave', severity: 'info', title: 'Leave requests to review', body: 'Several requests fall in the next two weeks.', link: '/ops/leave-planner', read: false, at: t(9, 15) },
    { key: 'n4', user: null, role: 'administrator', category: 'import', severity: 'warning', title: 'Import validated with errors', body: 'synthetic_extract_2026-09-13_partial.csv has 3 errors.', link: '/admin/data-import', read: false, at: t(18, 10) },
    { key: 'n5', user: null, role: 'planner', category: 'model', severity: 'info', title: 'Candidate forecast model available', body: 'placeholder-0.2 is a candidate. Every figure is Illustrative.', link: '/admin/forecast-model', read: true, at: t(2, 30) },
    { key: 'n6', user: null, role: 'dispatch_supervisor', category: 'fallback', severity: 'critical', title: 'Fallback was active for 12 minutes', body: 'The fallback dispatch assigned the cases from 15:40 to 15:52.', link: '/ops/live-dispatch', read: true, at: t(15, 53) },
    { key: 'n7', user: null, role: 'dispatcher', category: 'fallback', severity: 'critical', title: 'Fallback was active for 12 minutes', body: null, link: '/ops/live-dispatch', read: true, at: t(15, 53) },
    { key: 'n8', user: null, role: 'change_approver', category: 'update', severity: 'info', title: 'Update ready to schedule', body: 'A new release is downloaded and verified.', link: '/admin/updates', read: false, at: t(6, 0) },
    { key: 'n9', user: null, role: 'administrator', category: 'system', severity: 'warning', title: 'Backup overdue', body: 'The last successful backup was 30 hours ago.', link: '/admin/system-health', read: false, at: t(7, 30) },
    { key: 'n10', user: null, role: 'viewer_auditor', category: 'security', severity: 'info', title: 'Emergency admin signed in', body: 'One sign-in on 8 September.', link: '/admin/audit-log', read: true, at: parseIso('2026-09-08T14:12:00+03:00') },
    { key: 'n11', user: uid('planner'), role: null, category: 'roster', severity: 'warning', title: 'Roster rejected', body: 'Riyadh East, Monday 14 September: gaps in the afternoon peak.', link: '/ops/field-planner', read: false, at: t(21, 20) },
    { key: 'n12', user: null, role: 'dispatch_supervisor', category: 'rule', severity: 'info', title: 'Rule approved', body: 'RULE-005 version 1 took effect.', link: '/admin/classification-rules', read: true, at: parseIso('2026-08-01T00:05:00+03:00') },
    { key: 'n13', user: null, role: 'remote_team_lead', category: 'system', severity: 'info', title: 'Overnight remote queue cleared', body: 'All overnight cases were closed by 14:20.', link: '/ops/remote-queue', read: true, at: t(14, 25) },
    { key: 'n14', user: uid('administrator'), role: null, category: 'system', severity: 'info', title: 'Demo data loaded', body: 'Synthetic data for 6 to 13 September 2026.', link: null, read: true, at: parseIso('2026-09-05T20:05:00+03:00') },
  ];
  return defs.map((d) => ({
    ...base(ctx, 'notification', d.key, d.at),
    recipient_user_id: d.user,
    recipient_role: d.role,
    category: d.category,
    severity: d.severity,
    title_en: d.title,
    title_ar: null,
    body_en: d.body,
    link_path: d.link,
    is_read: d.read,
    read_at: d.read ? iso(d.at + 1800) : null,
  }));
}

export function buildAuditEvents(ctx: Ctx, users: readonly UserFx[]): Rec[] {
  const u = (key: string): UserFx => userByKey(users, key);
  type Def = { key: string; at: string; type: 'user' | 'system' | 'emergency_admin' | 'demo'; actor: string | null; action: string; entity: string; entityId: string | null; outcome: 'success' | 'failure' | 'denied'; summary: string; detail?: Rec };
  const defs: Def[] = [];
  // Rule approvals from the seeded approvals.
  RULE_DEFS.filter((r) => r.status === 'active').forEach((r) => {
    defs.push({ key: `rule|${r.code}`, at: '2026-07-28T09:30:00+03:00', type: 'user', actor: u('dispatch_supervisor').id, action: 'rule.approved', entity: 'rule_version', entityId: ruleVersionId(ctx, r.code, 1), outcome: 'success', summary: `${r.code} version 1 approved.`, detail: { rule_code: r.code, version: 1 } });
  });
  defs.push(
    { key: 'model|1', at: '2026-09-01T02:10:00+03:00', type: 'user', actor: u('administrator').id, action: 'model.activate', entity: 'model_version', entityId: 'ensemble-4', outcome: 'success', summary: 'Forecast model ensemble-4 made active.' },
    { key: 'import|1', at: '2026-09-05T21:45:00+03:00', type: 'user', actor: u('administrator').id, action: 'import.cut_over', entity: 'import_job', entityId: idOf(ctx, 'import_job', 'week'), outcome: 'success', summary: 'Import synthetic_cases_2026-09-06_to_2026-09-12.csv cut over.' },
    { key: 'signin|denied', at: '2026-09-07T08:02:00+03:00', type: 'user', actor: null, action: 'auth.sign_in', entity: 'session', entityId: null, outcome: 'denied', summary: 'Sign-in refused: no role rule matched the groups of the signed-in person.' },
    { key: 'emergency|1', at: '2026-09-08T14:12:00+03:00', type: 'emergency_admin', actor: u('emergency_admin').id, action: 'auth.emergency_sign_in', entity: 'session', entityId: null, outcome: 'success', summary: 'Emergency administrator signed in locally with MFA.' },
    { key: 'setting|1', at: '2026-09-09T10:15:00+03:00', type: 'user', actor: u('administrator').id, action: 'setting.update', entity: 'setting', entityId: 'live_assignment.stage.rd_c', outcome: 'success', summary: 'Live assignment stage of Riyadh Central set to recommend.', detail: { from: 'shadow', to: 'recommend' } },
    { key: 'setting|2', at: '2026-09-09T10:16:00+03:00', type: 'user', actor: u('administrator').id, action: 'setting.update', entity: 'setting', entityId: 'live_assignment.stage.rd_n', outcome: 'success', summary: 'Live assignment stage of Riyadh North set to recommend.', detail: { from: 'shadow', to: 'recommend' } },
    { key: 'roster|1', at: '2026-09-11T20:30:00+03:00', type: 'user', actor: u('dispatch_supervisor').id, action: 'roster.approve', entity: 'roster', entityId: idOf(ctx, 'roster', 'RD-N|2026-09-14'), outcome: 'success', summary: 'Roster for Riyadh North on 14 September approved.' },
    { key: 'roster|2', at: '2026-09-11T20:40:00+03:00', type: 'user', actor: u('dispatch_supervisor').id, action: 'roster.reject', entity: 'roster', entityId: idOf(ctx, 'roster', 'RD-E|2026-09-14'), outcome: 'success', summary: 'Roster for Riyadh East on 14 September rejected: gaps in the afternoon peak.' },
    { key: 'override|1', at: '2026-09-11T21:10:00+03:00', type: 'user', actor: u('dispatch_supervisor').id, action: 'override.approve', entity: 'override', entityId: idOf(ctx, 'override', 'o2'), outcome: 'success', summary: 'Vehicle change on Riyadh North roster approved.' },
    { key: 'fallback|1', at: '2026-09-12T15:40:00+03:00', type: 'system', actor: null, action: 'assignment.fallback_triggered', entity: 'integration', entityId: 'assignment_channel', outcome: 'success', summary: "OpenDispatch did not answer within 5 seconds; the fallback dispatch assigned the cases.", detail: { from: '15:40', to: '15:52' } },
    { key: 'integration|1', at: '2026-09-12T23:37:00+03:00', type: 'system', actor: null, action: 'integration.health_changed', entity: 'integration', entityId: 'agent_feed', outcome: 'success', summary: 'Agent feed health changed to degraded.' },
    { key: 'demo|1', at: '2026-09-05T20:05:00+03:00', type: 'demo', actor: null, action: 'demo.load', entity: 'fixtures', entityId: null, outcome: 'success', summary: 'Synthetic demo data loaded.' },
  );
  for (const [i, key] of ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'].entries()) {
    defs.push({ key: `signin|${key}`, at: `2026-09-12T${String(7 + Math.floor(i / 3)).padStart(2, '0')}:${String(5 + (i % 3) * 20).padStart(2, '0')}:00+03:00`, type: 'user', actor: u(key).id, action: 'auth.sign_in', entity: 'session', entityId: null, outcome: 'success', summary: `${u(key).displayName} signed in.` });
  }
  defs.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
  return defs.map((d) => {
    const at = parseIso(d.at);
    return {
      ...base(ctx, 'audit_event', d.key, at),
      occurred_at: iso(at),
      actor_type: d.type,
      actor_user_id: d.actor,
      action: d.action,
      entity_type: d.entity,
      entity_id: d.entityId,
      outcome: d.outcome,
      summary_en: d.summary,
      correlation_id: null,
      detail: d.detail ?? {},
    };
  });
}
