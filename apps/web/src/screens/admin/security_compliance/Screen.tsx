// SPDX-License-Identifier: AGPL-3.0-only
import { Card, CardHeader, StatusPill, Tag, type Tone } from '@opendispatch/ui';
import { date, time } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import { moduleAccess } from '@/lib/access';
import type { ScreenProps } from '@/screens/types';
import { EvidenceDrawer, LoadControlsButton, ResidencyBadge, SessionForm, SecurityHeader, UploadRowButton } from './SecurityForms';
import styles from './Security.module.css';
import { EndButton, GrantDialog, SupportPanel } from './SecuritySupport';
import { TITLE_KEY } from './titles';
import { CONTROL_STATUSES, FRAMEWORKS, TABS, type ControlRow, type ControlStatus, type Framework, type SupportGrant } from './types';
import { loadSecurityView } from './view';

// Security and Compliance: three tabs (Sessions, Controls, Support access), four figures, the evidence drawer
// and the grant dialog. A Server Component: it reads through lib/data with the request context ModuleRoute built and passes plain
// data to the client files. Tab, the controls' search and filters, the open control and the grant dialog live in the address (?tab=
// ?q= ?framework= ?status= ?control= ?grant=1); each is checked here against an allow-list. The Administrator edits; the MFA switch
// writes the Sign-in policy, so it is disabled with the Identity module's reason where that policy is read only (a shared install).
// Stubs: the evidence file is not stored (Demo); "Data residency: Saudi Arabia" is a fixed text.
// `?state=empty|loading|error` (demo-mode review hook) shows those states without reading data.

const STATUS_TONE: Readonly<Record<ControlStatus, Tone>> = { evidenced: 'success', in_progress: 'info', not_started: 'warning', not_applicable: 'neutral' };
const FRAMEWORK_COLOR: Readonly<Record<Framework, 'geekblue' | 'gold' | 'gray'>> = { NCA: 'geekblue', PDPL: 'gold', other: 'gray' };

type Translate = Awaited<ReturnType<typeof getTranslations>>;

export async function SecurityComplianceScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.security_compliance');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';
  const exportHeader = [m('col.control'), m('col.framework'), t('common.status'), m('col.evidence'), m('col.reviewed')];
  const exportFilename = 'controls-report.csv';
  const meta = <ResidencyBadge />;

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        meta={meta}
        actions={<SecurityHeader canEdit={canEdit} firstControlId={undefined} exportRows={undefined} exportHeader={exportHeader} exportFilename={exportFilename} />}
        emptyAction={<LoadControlsButton canEdit={canEdit} />}
      />
    );
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    q: param.text(80),
    framework: param.enum(FRAMEWORKS),
    status: param.enum(CONTROL_STATUSES),
    control: param.id(),
    grant: param.flag(),
    page: param.int(1, 1000),
  });
  const view = await loadSecurityView(ctx, { q: query.q, framework: query.framework, status: query.status, control: query.control });
  const tab = query.tab ?? 'sessions';
  const titleOf = (control: ControlRow): string => (TITLE_KEY[control.ref] === undefined ? control.title : m(TITLE_KEY[control.ref] as string));
  const titleNode = (control: ControlRow): ReactNode =>
    TITLE_KEY[control.ref] === undefined ? (
      <span lang="en" dir="ltr" translate="no">
        {control.title}
      </span>
    ) : (
      titleOf(control)
    );

  const tabs = (
    <UrlTabs
      id="sc3"
      ariaLabel={m('tabs.label')}
      defaultTab="sessions"
      resetParams={['q', 'sort', 'id', 'new', 'framework', 'status', 'control', 'grant']}
      tabs={[
        { value: 'sessions', label: m('tab.sessions') },
        { value: 'controls', label: m('tab.controls'), count: view.counts.total },
        { value: 'support', label: m('tab.support') },
      ]}
    />
  );

  const controlColumns: AdminTableColumn[] = [
    { key: 'control', header: m('col.control') },
    { key: 'framework', header: m('col.framework'), hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
    { key: 'evidence', header: m('col.evidence'), hideBelow: 'md' },
    { key: 'reviewed', header: m('col.reviewed'), hideBelow: 'md' },
    { key: 'actions', header: m('col.actions'), align: 'end' },
  ];
  const grantColumns: AdminTableColumn[] = [
    { key: 'started', header: m('sup.started') },
    { key: 'duration', header: m('sup.duration') },
    { key: 'by', header: m('sup.grantedBy'), hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
    { key: 'actions', header: m('col.actions'), align: 'end' },
  ];

  const exportRows = view.all.map((control) => [`${control.ref} ${titleOf(control)}`, control.framework === 'other' ? m('fw.other') : control.framework, m(`st.${control.status}`), control.note, control.reviewedAt === null ? '' : date(control.reviewedAt, { locale })]);
  const mfaReason = moduleAccess(ctx.role, 'admin.sign_in_identity', ctx.installMode).access === 'edit' ? null : m('mfa.shared');
  const notices: ReactNode[] = view.unknownControl ? [<RecordNotice key="control" param="control" message={m('notice.control')} />] : [];

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      meta={meta}
      tabs={tabs}
      isEmpty={view.all.length === 0}
      emptyAction={<LoadControlsButton canEdit={canEdit} />}
      actions={<SecurityHeader canEdit={canEdit} firstControlId={view.all[0]?.id} exportRows={exportRows} exportHeader={exportHeader} exportFilename={exportFilename} />}
    >
      <div className={styles.stack}>
        {notices}
        <StatStrip
          items={[
            { label: m('stat.evidenced'), value: view.counts.evidenced, unit: `/ ${view.counts.total}` },
            { label: m('st.in_progress'), value: view.counts.inProgress },
            { label: m('st.not_started'), value: view.counts.notStarted },
            { label: m('tab.support'), value: t(view.support.enabled ? 'common.on' : 'common.off') },
          ]}
        />
        {tab === 'sessions' ? (
          <TabPanel id="sc3" value="sessions">
            <Card padding="lg">
              <SessionForm session={view.session} mfaRequired={view.mfaRequired} canEdit={canEdit} mfaReason={mfaReason} />
            </Card>
          </TabPanel>
        ) : null}
        {tab === 'controls' ? (
          <TabPanel id="sc3" value="controls">
            <Card padding="none">
              <CardHeader title={m('ctl.title')} />
              <ListToolbar
                searchLabel={m('ctl.search')}
                filters={[
                  { key: 'framework', label: m('col.framework'), options: FRAMEWORKS.map((value) => ({ value, label: value === 'other' ? m('fw.other') : value })) },
                  { key: 'status', label: t('common.status'), options: CONTROL_STATUSES.map((value) => ({ value, label: m(`st.${value}`) })) },
                ]}
              />
              <AdminTable
                caption={m('ctl.title')}
                columns={controlColumns}
                rows={view.controls.map((control) => controlRow(control, titleNode(control), m, canEdit, locale))}
                rowParam="control"
                page={query.page}
                emptyState={<NoMatch title={m('noMatch')} clearParams={['q', 'framework', 'status']} />}
              />
            </Card>
          </TabPanel>
        ) : null}
        {tab === 'support' ? (
          <TabPanel id="sc3" value="support">
            <div className={styles.detailGrid}>
              <Card padding="none">
                <CardHeader title={m('sup.log')} />
                <AdminTable caption={m('sup.log')} columns={grantColumns} rows={view.support.grants.map((grant) => grantTableRow(grant, m, canEdit, locale))} rowParam={false} pageSize={0} />
              </Card>
              <aside className={styles.col}>
                <SupportPanel enabled={view.support.enabled} maxHours={view.support.maxHours} hasOpenGrant={view.support.openGrantId !== null} canEdit={canEdit} />
              </aside>
            </div>
          </TabPanel>
        ) : null}
      </div>
      <EvidenceDrawer key={view.openControl?.id ?? 'none'} control={view.openControl} options={view.all.map((control) => ({ id: control.id, label: `${control.ref} · ${titleOf(control)}` }))} canEdit={canEdit} />
      <GrantDialog open={query.grant === true && canEdit && view.support.enabled && view.support.openGrantId === null} maxHours={view.support.maxHours} />
    </ScreenFrame>
  );
}

function controlRow(control: ControlRow, title: ReactNode, m: Translate, canEdit: boolean, locale: 'en' | 'ar'): AdminTableRow {
  return {
    id: control.id,
    label: control.ref,
    cells: {
      control: (
        <span>
          <span className={styles.cellMain}>{title}</span>
          <span className={styles.cellSub} translate="no">
            {control.ref}
          </span>
        </span>
      ),
      framework: (
        <Tag color={FRAMEWORK_COLOR[control.framework]}>
          {control.framework === 'other' ? m('fw.other') : <span translate="no">{control.framework}</span>}
        </Tag>
      ),
      status: <StatusPill status={m(`st.${control.status}`)} tone={STATUS_TONE[control.status]} size="sm" />,
      evidence: control.note === '' ? <span className={styles.muted}>{m('none')}</span> : <span className={styles.cellSub} translate="no" dir="auto">{control.note}</span>,
      reviewed: control.reviewedAt === null ? <span className={styles.muted}>-</span> : <span translate="no">{date(control.reviewedAt, { locale })}</span>,
      actions: (
        <span className={styles.rowActions}>
          <UploadRowButton controlId={control.id} canEdit={canEdit} />
        </span>
      ),
    },
  };
}

function grantTableRow(grant: SupportGrant, m: Translate, canEdit: boolean, locale: 'en' | 'ar'): AdminTableRow {
  return {
    id: grant.id,
    label: date(grant.startedAt, { locale }),
    tone: grant.active ? 'warning' : undefined,
    cells: {
      started: (
        <span translate="no">
          <span className={styles.cellMain}>{date(grant.startedAt, { locale })}</span>
          <span className={styles.cellSub}>
            {time(grant.startedAt)}
            {grant.endsAt === null ? '' : ` - ${time(grant.endsAt)}`}
          </span>
        </span>
      ),
      duration: (
        <span>
          <bdi translate="no">{grant.hours}</bdi> {m('hoursShort')}
        </span>
      ),
      by: grant.grantedBy === null ? <span className={styles.muted}>-</span> : <span translate="no">{grant.grantedBy}</span>,
      status: <StatusPill status={m(grant.active ? 'sup.active' : 'sup.ended')} tone={grant.active ? 'warning' : 'neutral'} size="sm" />,
      actions: grant.active ? <EndButton grantId={grant.id} canEdit={canEdit} /> : null,
    },
  };
}

