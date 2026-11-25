// SPDX-License-Identifier: AGPL-3.0-only
import { Alert, Badge, Button, Card, CardHeader, DescriptionList, Progress, SegmentBar, Stat, StatusPill, Tooltip, type Tone } from '@opendispatch/ui';
import { date, num, time } from '@opendispatch/ui/format';
import { Check, ChevronRight, HeartPulse, Info, Lock, PackageCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { isolateLtr } from '@/components/opendispatch/isolateLtr';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { EnginesCard, isEngine, ENGINES_REVIEW } from './EnginesCard';
import { ConfirmBackupButton, DiagnosticsDrawer, HealthHeader, PreviewButton, RefreshButton } from './HealthForms';
import styles from './SystemHealth.module.css';
import { JOB_KINDS, JOB_STATUSES, TABS, type FeedHealth, type FeedRow, type JobRow, type ServiceRow, type ServiceStatus } from './types';
import { WeatherSub } from './WeatherSub';
import { enginesTile, loadEnginesView, loadHealthView, type EnginesTileDetail } from './view';

// System Health: three tabs (Overview, Job runs, Storage and backups), four figures, and the diagnostics
// drawer. A Server Component: it reads through lib/data with the request context ModuleRoute built and passes plain data to the
// client files. Tab, the job search and filters, and the diagnostics drawer live in the address (?tab= ?q= ?status= ?kind= ?diag=1);
// each is checked here against an allow-list. Stubs and labels: the storage figures are Illustrative (there is nothing to measure in
// the demo); the diagnostics file is scripted (Demo: it holds settings, health and job runs, never case or personal data); a
// backup confirmation is a record, not a backup. The Version card follows the install mode: the update agent's version only in a
// private install. `?state=empty|loading|error` (demo-mode review hook) shows those states without reading data.

const SERVICE_TONE: Readonly<Record<ServiceStatus, Tone>> = { ok: 'success', degraded: 'warning', down: 'danger', unknown: 'neutral' };
const FEED_TONE: Readonly<Record<FeedHealth, Tone>> = { healthy: 'success', degraded: 'warning', down: 'danger', unknown: 'neutral', disabled: 'neutral' };
const OVERALL_TONE: Readonly<Record<'healthy' | 'degraded' | 'down', Tone>> = { healthy: 'success', degraded: 'warning', down: 'danger' };
/** The mockup words each service's detail line itself; the data layer's own detail text is English and is not shown. */
const SERVICE_DETAIL: Readonly<Record<string, string>> = { api: 'svc.d.responding', worker: 'svc.d.jobs', database: 'svc.d.reachable', keycloak: 'svc.d.demo', object_storage: 'svc.d.reachable' };
const FEED_NAME: Readonly<Record<string, string>> = { case_feed: 'feed.case', agent_feed: 'feed.agent.label', assignment_channel: 'feed.assignment', weather_feed: 'feed.weather', routing_feed: 'feed.routing' };
/** The two job messages of the seeded runs the mockup translates, by the data layer's exact English text. */
const JOB_MESSAGE: Readonly<Record<string, string>> = { 'Validated with 3 errors and 1 warning.': 'job.m1', 'The file header is missing required columns.': 'job.m2' };
const GB = 1024 ** 3;
const AREA_KEY = { other: 'sto.other', backups: 'sto.backups', import_files: 'sto.imports', exports: 'sto.exports' } as const;
const AREA_COLOR = { other: 'var(--od-chart-1)', backups: 'var(--od-chart-4)', import_files: 'var(--od-chart-3)', exports: 'var(--od-chart-2)' } as const;

type Translate = Awaited<ReturnType<typeof getTranslations>>;

export async function SystemHealthScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.system_health');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<HealthHeader canEdit={canEdit} />} emptyAction={<RefreshButton />} />;
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    q: param.text(80),
    status: param.enum(JOB_STATUSES),
    kind: param.enum(JOB_KINDS),
    diag: param.flag(),
    page: param.int(1, 1000),
    engine: param.text(20),
    eng: param.enum(ENGINES_REVIEW),
  });
  const view = await loadHealthView(ctx, { q: query.q, status: query.status, kind: query.kind });
  const tab = query.tab ?? 'overview';
  const enginesRead = tab === 'overview' && (query.eng === undefined || query.eng === 'stale') ? await loadEnginesView(ctx) : undefined;
  const enginesCard = tab === 'overview' ? await EnginesCard({ view: enginesRead, locale, review: query.eng, open: isEngine(query.engine) ? query.engine : undefined }) : null;
  const tile = enginesTile(enginesRead, view.services.find((service) => service.name === 'engines')?.status ?? 'unknown');
  const services = view.services.map((service) => (service.name === 'engines' ? { ...service, status: tile.status } : service));
  const servicesUp = services.filter((service) => service.status === 'ok').length;
  const gb = (bytes: number) => num(bytes / GB, 1, locale);
  const version = `v${view.version.current}`;

  const meta = (
    <Tooltip content={m('version')}>
      <span tabIndex={0} data-version="">
        <Badge icon={<PackageCheck />}>
          <span translate="no">{version}</span>
        </Badge>
      </span>
    </Tooltip>
  );

  const tabs = (
    <UrlTabs
      id="sh"
      ariaLabel={m('tabs.label')}
      defaultTab="overview"
      resetParams={['q', 'sort', 'id', 'new', 'status', 'kind', 'diag', 'engine', 'eng']}
      tabs={[
        { value: 'overview', label: m('tab.overview') },
        { value: 'jobs', label: m('tab.jobs'), count: view.allJobs.length },
        { value: 'storage', label: m('tab.storage') },
      ]}
    />
  );

  const feedColumns: AdminTableColumn[] = [
    { key: 'feed', header: m('col.feed') },
    { key: 'direction', header: m('col.direction'), hideBelow: 'md' },
    { key: 'health', header: m('col.health') },
    { key: 'last', header: m('col.lastSuccess'), hideBelow: 'md' },
  ];
  const jobColumns: AdminTableColumn[] = [
    { key: 'job', header: m('col.job') },
    { key: 'kind', header: m('col.kind'), hideBelow: 'md' },
    { key: 'started', header: m('col.started') },
    { key: 'duration', header: m('col.duration'), align: 'end', hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
  ];

  const used = view.storage.usedBytes;
  const backup = view.backup;
  const agentRow = view.version.agent === null ? [] : [{ label: m('ver.agent'), value: <span translate="no">v{view.version.agent}</span> }];

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      meta={meta}
      tabs={tabs}
      actions={<HealthHeader canEdit={canEdit} />}
    >
      <div className={styles.stack}>
        <div className={styles.stats}>
          <Stat label={m('stat.overall')} icon={<HeartPulse />} value={<StatusPill status={m(`hl.${view.overall}`)} tone={OVERALL_TONE[view.overall]} />} />
          <Stat label={m('stat.services')} value={<ValueUnit value={servicesUp} unit={`/ ${view.counts.services}`} />} />
          <Stat label={m('stat.failed')} value={<bdi translate="no">{view.counts.failedJobs}</bdi>} />
          <Stat label={m('stat.storage')} value={<ValueUnit value={gb(used)} unit={`GB / ${num(view.storage.totalBytes / GB, 0, locale)} GB`} />} footer={<IllustrativeLabel />} />
        </div>
        {tab === 'overview' ? (
          <TabPanel id="sh" value="overview">
            <div className={styles.detailGrid}>
              <div className={styles.col}>
                <Card padding="lg">
                  <div className={styles.stack}>
                    <div className={styles.headRow}>
                      <h2 className={styles.sectionTitle}>{m('svc.title')}</h2>
                      <span className={styles.meta}>
                        {m('asOf')}{' '}
                        <span translate="no">
                          {date(view.asOf, { locale })}, <bdi dir="ltr">{time(view.asOf)}</bdi>
                        </span>
                      </span>
                    </div>
                    <div className={styles.services}>
                      {services.map((service) => (
                        <ServiceCard key={service.name} service={service} enginesDetail={tile.detail} m={m} version={version} agent={view.version.agent} installMode={view.version.installMode} />
                      ))}
                    </div>
                  </div>
                </Card>
                <Card padding="none">
                  <CardHeader
                    title={m('feeds.title')}
                    actions={
                      <Button variant="link" size="sm" href="/admin/data-sources" endIcon={<ChevronRight />}>
                        {m('feeds.open')}
                      </Button>
                    }
                  />
                  <AdminTable caption={m('feeds.title')} columns={feedColumns} rows={view.feeds.map((feed) => feedRow(feed, m, locale))} rowParam={false} pageSize={0} />
                </Card>
                {enginesCard}
              </div>
              <aside className={styles.col}>
                <Card padding="lg">
                  <div className={styles.stack}>
                    <div className={styles.headRow}>
                      <h2 className={styles.sectionTitle}>{m('ver.title')}</h2>
                      <Badge>
                        <span translate="no">{version}</span>
                      </Badge>
                    </div>
                    <DescriptionList
                      dense
                      columns={1}
                      items={[
                        { label: m('ver.channel'), value: view.version.channel === null ? '-' : m(`ver.${view.version.channel}`) },
                        { label: m('ver.install'), value: t(`installModes.${view.version.installMode}`) },
                        ...agentRow,
                      ]}
                    />
                    <div>
                      <Button variant="secondary" size="sm" href="/admin/updates" endIcon={<ChevronRight />}>
                        {m('ver.open')}
                      </Button>
                    </div>
                  </div>
                </Card>
                <Card padding="lg">
                  <div className={styles.stack}>
                    <div className={styles.headRow}>
                      <h2 className={styles.sectionTitle}>{m('diag.title')}</h2>
                    </div>
                    <ul className={styles.includes}>
                      <li>
                        <Check aria-hidden="true" size={16} />
                        <span>{m('diag.inc1')}</span>
                      </li>
                      <li>
                        <Check aria-hidden="true" size={16} />
                        <span>{m('diag.inc2')}</span>
                      </li>
                      <li>
                        <Lock aria-hidden="true" size={16} />
                        <span>{m('diag.inc3')}</span>
                      </li>
                    </ul>
                    <div>
                      <PreviewButton canEdit={canEdit} />
                    </div>
                  </div>
                </Card>
              </aside>
            </div>
          </TabPanel>
        ) : null}
        {tab === 'jobs' ? (
          <TabPanel id="sh" value="jobs">
            <Card padding="none">
              <CardHeader title={m('tab.jobs')} />
              <ListToolbar
                searchLabel={m('jobs.search')}
                filters={[
                  { key: 'status', label: t('common.status'), options: JOB_STATUSES.map((value) => ({ value, label: m(`st.${value}`) })) },
                  { key: 'kind', label: m('col.kind'), options: JOB_KINDS.map((value) => ({ value, label: m(`kind.${value}`) })) },
                ]}
              />
              <AdminTable caption={m('tab.jobs')} columns={jobColumns} rows={view.jobs.map((job) => jobTableRow(job, m, t, locale))} rowParam={false} page={query.page} emptyState={<NoMatch title={m('none')} clearParams={['q', 'status', 'kind']} />} />
            </Card>
          </TabPanel>
        ) : null}
        {tab === 'storage' ? (
          <TabPanel id="sh" value="storage">
            <div className={styles.twoCols}>
              <Card padding="lg">
                <div className={styles.stack}>
                  <div className={styles.headRow}>
                    <h2 className={styles.sectionTitle}>{m('sto.title')}</h2>
                    <IllustrativeLabel />
                  </div>
                  <Progress label={m('sto.used')} value={used} max={view.storage.totalBytes} tone="success" showValue valueLabel={isolateLtr(`${gb(used)} GB / ${num(view.storage.totalBytes / GB, 0, locale)} GB`)} />
                  <SegmentBar segments={view.storage.areas.map((area) => ({ value: area.usedBytes, color: AREA_COLOR[area.area], label: m(AREA_KEY[area.area]) }))} />
                  <ul className={styles.legend}>
                    {[...view.storage.areas]
                      .sort((a, b) => b.usedBytes - a.usedBytes)
                      .map((area) => (
                        <li key={area.area} className={styles.legendItem}>
                          <span className={styles.swatch} style={{ background: AREA_COLOR[area.area] }} aria-hidden="true" />
                          <span className={styles.legendLabel}>{m(AREA_KEY[area.area])}</span>
                          <span className={styles.legendValue} translate="no">
                            {gb(area.usedBytes)} GB
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              </Card>
              <Card padding="lg">
                <div className={styles.stack}>
                  <div className={styles.headRow}>
                    <h2 className={styles.sectionTitle}>{m('bk.title')}</h2>
                    <StatusPill status={m(backup.overdue ? 'bk.overdue' : 'bk.confirmed')} tone={backup.overdue ? 'warning' : 'success'} size="sm" />
                  </div>
                  <Alert tone="info" icon={<Info />}>
                    {m(view.version.installMode === 'private' ? 'bk.own' : 'bk.managed')}
                  </Alert>
                  <DescriptionList
                    dense
                    columns={1}
                    items={[
                      {
                        label: m('bk.last'),
                        value:
                          backup.lastConfirmedAt === null ? (
                            '-'
                          ) : (
                            <span translate="no">
                              {date(backup.lastConfirmedAt, { locale })}, <bdi dir="ltr">{time(backup.lastConfirmedAt)}</bdi>
                            </span>
                          ),
                      },
                      { label: m('bk.by'), value: backup.confirmedBy === null ? '-' : <span translate="no">{backup.confirmedBy}</span> },
                      { label: m('bk.source'), value: backup.source === 'customer_reported' ? m('bk.customer') : m(`bk.src.${backup.source}`) },
                      { label: m('bk.drill'), value: backup.restoreDrillDue === null ? '-' : <span translate="no">{date(backup.restoreDrillDue, { locale })}</span> },
                    ]}
                  />
                  <ConfirmBackupButton canEdit={canEdit} />
                </div>
              </Card>
            </div>
          </TabPanel>
        ) : null}
      </div>
      <DiagnosticsDrawer open={query.diag === true && canEdit} preview={view.diagnostics} canEdit={canEdit} />
    </ScreenFrame>
  );
}

function engineDetail(detail: EnginesTileDetail, m: Translate): string | null {
  return detail === null ? null : detail.kind === 'fixture' ? m('svc.d.fixture') : m('svc.d.enginesOn', { n: detail.on, m: detail.total });
}

function ServiceCard({ service, enginesDetail, m, version, agent, installMode }: { service: ServiceRow; enginesDetail: EnginesTileDetail; m: Translate; version: string; agent: string | null; installMode: string }): ReactNode {
  const versionText = service.name === 'web' ? version : service.name === 'update_agent' && installMode === 'private' && agent !== null ? `v${agent}` : null;
  const detail = service.name === 'web' ? null : service.name === 'update_agent' ? (installMode === 'private' ? null : 'svc.d.vendor') : (SERVICE_DETAIL[service.name] ?? null);
  return (
    <div className={styles.service} data-service={service.name}>
      <div className={styles.serviceHead}>
        <span>{m(`svc.${service.name}`)}</span>
        <StatusPill status={m(`svc.st.${service.status}`)} tone={SERVICE_TONE[service.status]} size="sm" />
      </div>
      <span className={styles.meta}>
        {versionText === null ? null : <span translate="no">{versionText} </span>}
        {service.name === 'engines' ? engineDetail(enginesDetail, m) : detail === null ? null : m(detail)}
      </span>
    </div>
  );
}

function feedRow(feed: FeedRow, m: Translate, locale: 'en' | 'ar'): AdminTableRow {
  const key = FEED_NAME[feed.kind];
  return {
    id: feed.id,
    label: feed.name,
    tone: feed.health === 'degraded' ? 'warning' : feed.health === 'down' ? 'danger' : undefined,
    cells: {
      feed: (
        <span>
          <span className={styles.cellMain}>{key === undefined ? <span lang="en" dir="ltr" translate="no">{feed.name}</span> : m(key)}</span>
          {feed.error === null ? null : (
            <span className={styles.cellSub} lang="en" dir="ltr" translate="no">
              {feed.error}
            </span>
          )}
          {feed.error === null && feed.weather !== null ? <WeatherSub source={feed.weather} label={(key, values) => m(key, values)} locale={locale} /> : null}
        </span>
      ),
      direction: m(feed.direction === 'outbound' ? 'dir.out' : 'dir.in'),
      health: <StatusPill status={m(`hl.${feed.health}`)} tone={FEED_TONE[feed.health]} size="sm" />,
      last: feed.lastSuccessAt === null ? <span className={styles.muted}>-</span> : stamp(feed.lastSuccessAt, locale),
    },
  };
}

function stamp(iso: string, locale: 'en' | 'ar'): ReactNode {
  return (
    <span translate="no">
      <span className={styles.cellMain}>{date(iso, { locale })}</span>
      <span className={styles.cellSub}>{time(iso)}</span>
    </span>
  );
}

/** A figure and its unit as one left-to-right run, so "7 / 8" and "2.9 GB / 100 GB" keep their order in Arabic. */
function ValueUnit({ value, unit }: { value: ReactNode; unit: string }) {
  return (
    <bdi dir="ltr" translate="no" className={styles.valueUnit}>
      <span>{value}</span>
      <span className={styles.unit}>{unit}</span>
    </bdi>
  );
}

function durationOf(ms: number | null, t: Translate, locale: 'en' | 'ar'): ReactNode {
  if (ms === null) return <span className={styles.muted}>-</span>;
  const seconds = ms / 1000;
  if (seconds < 60) return <bdi dir="ltr" translate="no">{`${num(seconds, Number.isInteger(seconds) ? 0 : 1, locale)} s`}</bdi>;
  const whole = Math.round(seconds);
  return (
    <>
      <bdi translate="no">{`${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`}</bdi> {t('common.minShort')}
    </>
  );
}

function jobTableRow(job: JobRow, m: Translate, t: Translate, locale: 'en' | 'ar'): AdminTableRow {
  const failed = job.status === 'failed';
  const messageKey = job.message === null ? undefined : JOB_MESSAGE[job.message];
  return {
    id: job.id,
    label: job.name,
    tone: failed ? 'danger' : undefined,
    cells: {
      job: (
        <span>
          <span className={styles.cellMain} translate="no">
            {job.name}
          </span>
          {job.message === null ? null : messageKey === undefined ? (
            <span className={styles.cellSub} lang="en" dir="ltr" translate="no">
              {job.message}
            </span>
          ) : (
            <span className={styles.cellSub}>{m(messageKey)}</span>
          )}
        </span>
      ),
      kind: m(`kind.${job.kind === 'other' ? 'other' : job.kind}`),
      started: job.startedAt === null ? <span className={styles.muted}>-</span> : stamp(job.startedAt, locale),
      duration: durationOf(job.durationMs, t, locale),
      status: <StatusPill status={m(`st.${job.status}`)} tone={failed ? 'danger' : job.status === 'succeeded' ? 'success' : 'info'} size="sm" />,
    },
  };
}
