// SPDX-License-Identifier: AGPL-3.0-only
import { getTranslations } from 'next-intl/server';
import { assistantAvailability } from '@/components/opendispatch/assistant/availability';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { EmptyUpload, ImportHeader } from './ImportHeader';
import { ImportTab } from './ImportTab';
import { IssuesTab } from './IssuesTab';
import { JobsTab } from './JobsTab';
import { ISSUE_STATUSES, ISSUE_TYPES, SEVERITIES, TABS } from './types';
import styles from './DataImport.module.css';
import { loadImportView, mappingFileName } from './view';

// Data Import and Quality. A Server Component: it reads through lib/data with the request context
// ModuleRoute built and passes plain data to the client files (the import steps, the issues table and its drawer, the jobs). Tab,
// job, filters, search, page and the open issue live in the address (?tab= ?job= ?severity= ?status= ?type= ?q= ?page= ?issue=);
// each is checked here against an allow-list. `?state=empty|loading|error` (demo-mode review hook) shows those states without
// reading data. A role with no access never reaches this screen; a view-only role sees every control disabled with the reason.
//
// Real the customer data never enters this repository.

const first = (value: string | readonly string[] | undefined): string | undefined => (typeof value === 'string' ? value : value?.[0]);

export async function DataImportQualityScreen({ def, ctx, access, homeHref, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.data_import_quality');
  const t = await getTranslations();
  const canEdit = access.access === 'edit';
  const mappingHeader = [m('map.colSource'), m('col.field'), m('map.colRequired')];
  const issueHeader = [m('col.severity'), m('col.issue'), m('col.row'), m('col.field'), t('common.status'), m('col.job')];

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        actions={<ImportHeader canEdit={canEdit} mappingRows={undefined} mappingFilename="mapping.csv" mappingHeader={mappingHeader} issueRows={undefined} issueHeader={issueHeader} />}
        emptyAction={<EmptyUpload canEdit={canEdit} />}
      />
    );
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    job: param.id(),
    severity: param.enum(SEVERITIES),
    status: param.enum(ISSUE_STATUSES),
    type: param.enum(ISSUE_TYPES),
    q: param.text(80),
    issue: param.id(),
    page: param.int(1, 1000),
  });
  const [view, assistant] = await Promise.all([loadImportView(ctx, { job: query.job, severity: query.severity, status: query.status, type: query.type, q: query.q, issue: query.issue }, first(searchParams['job']), first(searchParams['issue'])), assistantAvailability(ctx)]);
  const help = assistant === null ? null : { configured: assistant.configured, mapping: assistant.importMapping, issues: assistant.importIssues };
  const job = view.current;
  const tab = query.tab ?? 'import';

  const mappingRows = view.mapping === null ? [] : view.mapping.columns.map((c) => [c.source, c.internal, c.required ? t('common.on') : t('common.off')]);
  const issueRows = view.issues.map((i) => [m(`sev.${i.severity}`), m(`type.${i.type}`), i.row === null ? '' : String(i.row), i.field ?? '', m(`st.${i.status}`), i.jobFile]);
  const none = job === null || job.status === 'uploaded' || job.status === 'validating';

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      actions={<ImportHeader canEdit={canEdit} mappingRows={mappingRows} mappingFilename={mappingFileName(view.mapping)} mappingHeader={mappingHeader} issueRows={issueRows} issueHeader={issueHeader} />}
      tabs={
        <UrlTabs
          id="dq"
          ariaLabel={m('tabs.label')}
          defaultTab="import"
          resetParams={['q', 'sort', 'id', 'new', 'issue', 'page', 'severity', 'status', 'type']}
          tabs={[
            { value: 'import', label: m('tab.import') },
            { value: 'issues', label: m('tab.issues'), count: view.issuesTotal },
            { value: 'jobs', label: m('tab.jobs'), count: view.jobs.length },
          ]}
        />
      }
    >
      <div className={styles.stack}>
        {view.unknownIssue ? <RecordNotice param="issue" message={m('notice.issueNotFound')} /> : null}
        {view.unknownJob ? <RecordNotice param="job" message={m('notice.jobNotFound')} /> : null}
        <StatStrip
          items={[
            { label: m('stat.rows'), value: job === null ? '-' : job.rows },
            { label: m('stat.errors'), value: none ? '-' : (job?.errors ?? 0) },
            { label: m('stat.warnings'), value: none ? '-' : (job?.warnings ?? 0) },
            { label: m('stat.held'), value: view.held ?? '-' },
          ]}
        />
        <TabPanel id="dq" value={tab}>
          {tab === 'import' ? <ImportTab job={job} mapping={view.mapping} canEdit={canEdit} demo={view.demo} help={help} /> : null}
          {tab === 'issues' ? <IssuesTab issues={view.issues} jobs={view.jobs} total={view.issuesTotal} open={view.open} page={query.page} canEdit={canEdit} help={help} helpJob={job} /> : null}
          {tab === 'jobs' ? <JobsTab jobs={view.jobs} currentId={job?.id ?? null} /> : null}
        </TabPanel>
      </div>
    </ScreenFrame>
  );
}
