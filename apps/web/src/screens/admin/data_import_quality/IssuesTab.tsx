'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, DescriptionList, Field, SegmentedControl, StatusPill, Textarea, useToast, type Tone } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Qualifier } from '@/components/opendispatch/Qualifier';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { setIssueStatus } from './actions';
import { IssuesHelp } from './IssuesHelp';
import { issueLine, issueText, splitData } from './issueMessage';
import { ISSUE_STATUSES, ISSUE_TYPES, SEVERITIES, type ImportHelp, type IssueDetail, type IssueRow, type IssueStatus, type JobRow, type Severity } from './types';
import styles from './DataImport.module.css';
import { useDateTime } from '@/components/opendispatch/useDateTime';

// The Issues tab: every data quality issue with a search box
// and four filters (severity, status, issue, job), and a drawer for one issue (`?issue=`) where its status is set with an optional note.
// An issue's line is translated by its pattern; an unknown line stays English. Handling is `field` or `remote_inferred` until the customer
// supplies an explicit field: the drawer says "inferred".

const SEVERITY_TONE: Readonly<Record<Severity, Tone>> = { error: 'danger', warning: 'warning', info: 'info' };
const ROW_TONE: Readonly<Record<Severity, Tone>> = { error: 'danger', warning: 'warning', info: 'info' };

export interface IssuesTabProps {
  readonly issues: readonly IssueRow[];
  readonly jobs: readonly JobRow[];
  readonly total: number;
  readonly open: IssueDetail | undefined;
  readonly page: number | undefined;
  readonly canEdit: boolean;
  /** Assistant features; null hides them. */
  readonly help?: ImportHelp | null | undefined;
  /** The job the help explains. */
  readonly helpJob?: JobRow | null | undefined;
}

export function IssuesTab({ issues, jobs, total, open, page, canEdit, help = null, helpJob = null }: IssuesTabProps) {
  const m = useTranslations('admin.data_import_quality');
  const t = useTranslations();

  const columns: AdminTableColumn[] = [
    { key: 'severity', header: m('col.severity') },
    { key: 'issue', header: m('col.issue') },
    { key: 'row', header: m('col.row'), align: 'end' },
    { key: 'field', header: m('col.field'), hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
    { key: 'job', header: m('col.job'), hideBelow: 'lg' },
  ];
  const rows: AdminTableRow[] = issues.map((issue) => ({
    id: issue.id,
    tone: ROW_TONE[issue.severity],
    cells: {
      severity: <StatusPill status={m(`sev.${issue.severity}`)} tone={SEVERITY_TONE[issue.severity]} size="sm" />,
      issue: (
        <span className={styles.stackTight}>
          <span className={styles.strong}>{typeName(issue.type, m)}</span>
          <span className={styles.meta}>
            <IssueMessage message={issue.message} field={issue.field} />
          </span>
        </span>
      ),
      row: <bdi translate="no">{issue.row ?? '-'}</bdi>,
      field: <span translate="no">{issue.field ?? '-'}</span>,
      status: <StatusPill status={m(`st.${issue.status}`)} tone={issue.status === 'open' ? 'warning' : issue.status === 'resolved' ? 'success' : 'neutral'} size="sm" />,
      job: <span translate="no">{issue.jobFile.length > 26 ? `${issue.jobFile.slice(0, 26)}...` : issue.jobFile}</span>,
    },
  }));

  const table = (
    <Card padding="none">
      <ListToolbar
        searchLabel={m('search')}
        filters={[
          { key: 'severity', label: m('col.severity'), options: SEVERITIES.map((value) => ({ value, label: m(`sev.${value}`) })) },
          { key: 'status', label: t('common.status'), options: ISSUE_STATUSES.map((value) => ({ value, label: m(`st.${value}`) })) },
          { key: 'type', label: m('col.issue'), options: ISSUE_TYPES.map((value) => ({ value, label: typeName(value, m) })) },
          { key: 'job', label: m('col.job'), options: jobs.map((j) => ({ value: j.id, label: j.file })) },
        ]}
      />
      <AdminTable caption={m('tab.issues')} columns={columns} rows={rows} rowParam="issue" page={page} emptyState={<NoMatch title={m('nomatch')} clearParams={['q', 'severity', 'status', 'type', 'job']} />} />
      <div className={styles.summary}>{m('i.sum', { n: issues.length, total })}</div>
      <IssueDrawer issue={open} canEdit={canEdit} />
    </Card>
  );
  if (help === null || !help.issues) return table;
  return (
    <div className={styles.stack}>
      <IssuesHelp key={helpJob?.id ?? ''} jobId={helpJob?.id ?? null} help={help} empty={(helpJob?.issues ?? 0) === 0} />
      {table}
    </div>
  );
}

/** An issue line in the reader's language; an unknown line stays English. */
function IssueMessage({ message, field }: { message: string; field: string | null }) {
  const m = useTranslations('admin.data_import_quality');
  const known = issueText(message, field);
  if (known !== null) {
    const line = issueLine((key, values) => m(key as never, values as never), known, true);
    return (
      <span>
        {splitData(line).map((part, i) =>
          part.data ? (
            <bdi key={i} translate="no">
              {part.text}
            </bdi>
          ) : (
            part.text
          ),
        )}
      </span>
    );
  }
  return (
    <span lang="en" dir="ltr" translate="no">
      {message}
    </span>
  );
}

/** The name of an issue type in the reader's language (`other` has its own line). */
function typeName(type: IssueRow['type'], m: (key: string) => string): string {
  return type === 'other' ? m('type.other') : m(`type.${type}`);
}

function IssueDrawer({ issue, canEdit }: { issue: IssueDetail | undefined; canEdit: boolean }) {
  const m = useTranslations('admin.data_import_quality');
  const t = useTranslations();
  const dateTime = useDateTime();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [status, setStatus] = useState<IssueStatus>(issue?.status ?? 'open');
  const [note, setNote] = useState('');
  const [seen, setSeen] = useState<string | undefined>(issue?.id);
  if (issue?.id !== seen) {
    setSeen(issue?.id);
    setStatus(issue?.status ?? 'open');
    setNote('');
  }
  const save = useAdminAction(setIssueStatus, {
    quiet: true,
    onSuccess: (outcome) => toast({ title: m('toast.issue', { status: m(`st.${outcome.status}`) }), description: typeName(outcome.type, m), tone: 'success' }),
  });

  if (issue === undefined) return <RecordDrawer open={false} param="issue" title="" />;
  const facts = issue.caseFacts;
  const at = (iso: string | null) => (iso === null ? '-' : dateTime(iso));
  const reason = gate.edit.reason;
  const footer = (
    <div className={styles.footer}>
      <span className={styles.push} />
      <ReasonHint reason={reason} visible={false}>
        <Button variant="primary" loading={save.pending} onClick={() => reason === null && save.run({ issueId: issue.id, status, note })}>
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <RecordDrawer
      open
      param="issue"
      recordKey={issue.id}
      title={typeName(issue.type, m)}
      subtitle={
        <span translate="no">
          {issue.jobFile}
          {issue.row === null ? '' : ` · ${m('d.row', { n: issue.row })}`}
        </span>
      }
      footer={footer}
    >
      <div className={styles.stack}>
        <DescriptionList
          dense
          columns={1}
          items={[
            { label: m('col.severity'), value: <StatusPill status={m(`sev.${issue.severity}`)} tone={SEVERITY_TONE[issue.severity]} size="sm" /> },
            {
              label: m('d.message'),
              value: (
                <IssueMessage message={issue.message} field={issue.field} />
              ),
            },
            { label: m('col.field'), value: <span translate="no">{issue.field ?? '-'}</span> },
            { label: m('col.row'), value: <bdi translate="no">{issue.row ?? '-'}</bdi> },
          ]}
        />
        {facts === null ? null : (
          <Card padding="md" tone="subtle">
            <div className={styles.stack}>
              <span className={styles.strong}>{m('d.caseFacts')}</span>
              <DescriptionList
                dense
                columns={2}
                items={[
                  { label: m('d.case'), value: <span translate="no">{facts.number}</span> },
                  { label: t('common.zone'), value: <span translate="no">{facts.zone}</span> },
                  { label: m('d.registered'), value: <bdi dir="ltr" translate="no">{at(facts.registeredAt)}</bdi> },
                  { label: m('d.assigned'), value: <bdi dir="ltr" translate="no">{at(facts.assignedAt)}</bdi> },
                  { label: m('d.parties'), value: <bdi translate="no">{facts.parties}</bdi> },
                  {
                    label: m('d.handling'),
                    value: (
                      <span>
                        {facts.handling === 'field' ? m('d.field') : m('d.remote')} <Qualifier>{m('d.inferred')}</Qualifier>
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </Card>
        )}
        <Field label={t('common.status')}>
          <SegmentedControl
            size="sm"
            ariaLabel={t('common.status')}
            value={status}
            onChange={(next) => reason === null && setStatus(ISSUE_STATUSES.find((s) => s === next) ?? status)}
            options={ISSUE_STATUSES.map((value) => ({ value, label: m(`st.${value}`) }))}
          />
        </Field>
        <Field label={t('common.note')} optional>
          <Textarea value={note} rows={3} maxLength={500} disabled={reason !== null} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {reason === null ? null : <Reason>{reason}</Reason>}
        <ActionError error={save.error} onDismiss={save.reset} />
      </div>
    </RecordDrawer>
  );
}
