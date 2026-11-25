// SPDX-License-Identifier: AGPL-3.0-only
import { Card, EmptyState, Inline, StatusPill } from '@opendispatch/ui';
import { Inbox, UserX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AssignDrawer } from './AssignDrawer';
import { loadCaseAiCard } from '@/components/opendispatch/assistant/caseCard';
import { DayNav } from './DayNav';
import { HeaderActions, RefreshButton } from './HeaderActions';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Qualifier } from '@/components/opendispatch/Qualifier';
import { RosterGrid, type RosterRow } from '@/components/opendispatch/RosterGrid';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip, type StatItem } from '@/components/opendispatch/patterns/StatStrip';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenEmpty, ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { PerformanceChart } from './PerformanceChart';
import { QueueTable } from './QueueTable';
import styles from './RemoteQueue.module.css';
import { StaffingChart } from './StaffingChart';
import { QUEUE_TABS, REMOTE_VIEWS, WAIT_THRESHOLDS } from './types';
import { loadRemotePerformanceView, loadRemoteQueueView, loadRemoteRosterView, TABLE_PAGE_SIZE } from './view';

// Remote Queue and Scheduling (Ops 3

type Translate = Awaited<ReturnType<typeof getTranslations>>;

const GRID_START = 6;

const VIEW_RESET =['tab', 'q', 'zone', 'wait', 'assign', 'page', 'date', 'pool', 'id'] as const;

function CardTitle({ title, extra }: { readonly title: string; readonly extra?: ReactNode }) {
  return (
    <div className={styles.cardHeader}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {extra}
    </div>
  );
}

export async function RemoteQueueScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.remote_queue');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<HeaderActions firstWaitingCaseId={null} canEdit={canEdit} />} emptyAction={<RefreshButton />} />;
  }

  const query = parseSearchParams(searchParams, {
    view: param.enum(REMOTE_VIEWS),
    tab: param.enum(QUEUE_TABS),
    q: param.text(80),
    zone: param.pattern(/^[A-Za-z0-9-]{1,16}$/, 16),
    wait: param.enum(WAIT_THRESHOLDS),
    assign: param.id(),
    page: param.int(1, 1000),
    date: param.pattern(/^\d{4}-\d{2}-\d{2}$/, 10),
    pool: param.pattern(/^[A-Za-z0-9-]{1,16}$/, 16),
  });
  const view = query.view ?? 'queue';

  const viewTabs = (
    <UrlTabs
      id="rqv"
      param="view"
      ariaLabel={m('views.label')}
      defaultTab="queue"
      resetParams={VIEW_RESET}
      selected={view}
      tabs={[
        { value: 'queue', label: m('view.queue') },
        { value: 'roster', label: m('view.roster') },
        { value: 'performance', label: m('view.performance') },
      ]}
    />
  );

  if (view === 'roster') {
    const roster = await loadRemoteRosterView(ctx, { date: query.date, pool: query.pool }, locale);
    return (
      <ScreenFrame def={def} access={access} homeHref={homeHref} sources={roster.sources} tabs={viewTabs} actions={<HeaderActions firstWaitingCaseId={null} canEdit={canEdit} />}>
        <TabPanel id="rqv" value="roster">
          <RosterPanel roster={roster} m={m} t={t} />
        </TabPanel>
      </ScreenFrame>
    );
  }

  if (view === 'performance') {
    const perf = await loadRemotePerformanceView(ctx, locale);
    return (
      <ScreenFrame def={def} access={access} homeHref={homeHref} sources={perf.sources} tabs={viewTabs} actions={<HeaderActions firstWaitingCaseId={null} canEdit={canEdit} />}>
        <TabPanel id="rqv" value="performance">
          {perf.isEmpty ? <ScreenEmpty moduleId={def.id} compact /> : <PerformancePanel perf={perf} m={m} t={t} />}
        </TabPanel>
      </ScreenFrame>
    );
  }

  const queueView = await loadRemoteQueueView(ctx, query, locale);
  const aiCard = queueView.drawer === undefined ? null : await loadCaseAiCard(ctx, queueView.drawer.caseId, 'remote_queue', locale);
  const tab = query.tab ?? 'waiting';
  const description = queueView.isEmpty || queueView.queueDateLabel === null || queueView.asOfTimeLabel === null ? undefined : m('sub', { date: queueView.queueDateLabel, time: queueView.asOfTimeLabel });

  const stats: StatItem[] = [
    { label: m('stat.waiting'), value: queueView.stats.waiting },
    { label: m('stat.inReview'), value: queueView.stats.inReview },
    { label: m('stat.longest'), value: queueView.stats.longestWaitLabel, unit: m('unit.h') },
    {
      label: m('stat.gap'),
      value: queueView.stats.peakGap === null ? '—' : queueView.stats.peakGap.valueLabel,
      hint:
        queueView.stats.peakGap === null ? (
          <IllustrativeLabel />
        ) : (
          <>
            {m('stat.gapAt', { time: queueView.stats.peakGap.atLabel })} <IllustrativeLabel />
          </>
        ),
    },
  ];

  const statusTabs = (
    <UrlTabs
      id="rq"
      variant="pill"
      ariaLabel={m('tabs.label')}
      defaultTab="waiting"
      tabs={[
        { value: 'waiting', label: m('tab.waiting'), count: queueView.counts.waiting },
        { value: 'in_review', label: m('tab.inReview'), count: queueView.counts.in_review },
        { value: 'done', label: m('tab.done'), count: queueView.counts.done },
      ]}
    />
  );

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={queueView.sources}
      description={description}
      tabs={viewTabs}
      actions={<HeaderActions firstWaitingCaseId={queueView.firstWaitingCaseId} canEdit={canEdit} />}
    >
      <TabPanel id="rqv" value="queue">
        {queueView.isEmpty ? (
          <ScreenEmpty moduleId={def.id} compact action={<RefreshButton />} />
        ) : (
          <div className={styles.stack}>
            <StatStrip items={stats} />

            <Card padding="lg">
              <div className={styles.cardHeadRow}>
                <div className={styles.cardTitleRow}>
                  <h2 className={styles.cardTitle}>{m('staff.title')}</h2>
                  <IllustrativeLabel />
                </div>
                <div className={styles.dateRow}>
                  <span translate="no">{queueView.staffing.dateLabel}</span>
                  <span>{m('staff.step')}</span>
                </div>
              </div>
              <StaffingChart staffing={queueView.staffing} />
            </Card>

            <Card padding="none">
              <CardTitle title={m('queue.title')} extra={statusTabs} />
              <ListToolbar
                searchLabel={m('search')}
                filters={[
                  { key: 'zone', label: t('common.zone'), options: queueView.zoneOptions },
                  {
                    key: 'wait',
                    label: m('filter.wait'),
                    options: [
                      { value: '60', label: m('wait.1h') },
                      { value: '240', label: m('wait.4h') },
                    ],
                  },
                ]}
              />
              <TabPanel id="rq" value={tab}>
                <QueueTable
                  rows={queueView.rows}
                  caption={m('table.caption')}
                  emptyState={<EmptyState compact icon={<Inbox />} title={m('rows.empty')} />}
                  pageSize={TABLE_PAGE_SIZE}
                  page={query.page}
                  canEdit={canEdit}
                />
              </TabPanel>
            </Card>
          </div>
        )}
      </TabPanel>

      <AssignDrawer target={queueView.drawer} canEdit={canEdit} ai={aiCard} />
    </ScreenFrame>
  );
}

type RosterView = Awaited<ReturnType<typeof loadRemoteRosterView>>;
type PerformanceView = Awaited<ReturnType<typeof loadRemotePerformanceView>>;

const num = (text: string) => <span translate="no">{text}</span>;
const signedNum = (text: string) => (
  <bdi dir="ltr" translate="no">
    {text}
  </bdi>
);

function RosterPanel({ roster, m, t }: { readonly roster: RosterView; readonly m: Translate; readonly t: Translate }) {
  const stats: StatItem[] = [
    { label: m('ro.stat.onShift'), value: roster.onShift, unit: m('ro.of', { n: String(roster.fte) }) },
    { label: m('ro.stat.demand'), value: roster.demandLabel, unit: m('unit.h'), hint: <IllustrativeLabel /> },
    { label: m('ro.stat.util'), value: roster.utilizationLabel ?? '—', hint: <IllustrativeLabel /> },
    { label: m('ro.stat.gap'), value: roster.gapLabel, unit: m('unit.h'), hint: <IllustrativeLabel /> },
  ];

  const shiftColumns: AdminTableColumn[] = [
    { key: 'shift', header: m('sh.col.shift') },
    { key: 'hours', header: m('sh.col.hours'), hideBelow: 'md' },
    { key: 'scheduled', header: m('sh.col.scheduled'), align: 'end' },
    { key: 'demand', header: m('sh.col.demand'), align: 'end' },
    { key: 'capacity', header: m('sh.col.capacity'), align: 'end', hideBelow: 'md' },
    { key: 'util', header: m('sh.col.util'), align: 'end' },
    { key: 'gap', header: m('sh.col.gap'), align: 'end' },
  ];
  const shiftRows: AdminTableRow[] = roster.shifts.map((s) => ({
    id: s.id,
    label: s.name ?? m('sh.outside'),
    tone: s.isGap ? 'danger' : undefined,
    cells: {
      shift: s.name === null ? <span>{m('sh.outside')}</span> : <span translate="no">{s.name}</span>,
      hours: signedNum(s.hoursLabel),
      scheduled: num(String(s.scheduled)),
      demand: num(s.demandLabel),
      capacity: num(s.capacityLabel),
      util: num(s.utilizationLabel),
      gap: signedNum(s.gapLabel),
    },
  }));

  const weekColumns: AdminTableColumn[] = [
    { key: 'day', header: m('wk.col.day') },
    { key: 'demand', header: m('sh.col.demand'), align: 'end' },
    { key: 'capacity', header: m('sh.col.capacity'), align: 'end' },
    { key: 'gap', header: m('sh.col.gap'), align: 'end' },
    { key: 'worst', header: m('wk.col.worst'), hideBelow: 'md' },
  ];
  const weekRows: AdminTableRow[] = [
    ...roster.week.map(
      (d): AdminTableRow => ({
        id: d.date,
        label: d.dateLabel,
        tone: d.isGap ? 'danger' : undefined,
        cells: {
          day: <span translate="no">{d.dateLabel}</span>,
          demand: num(d.demandLabel),
          capacity: num(d.capacityLabel),
          gap: signedNum(d.gapLabel),
          worst: d.noCapacity ? (
            <Qualifier>{m('wk.noRoster')}</Qualifier>
          ) : d.worst === null ? (
            <span>—</span>
          ) : (
            <>
              {signedNum(d.worst.valueLabel)} <span className={styles.muted}>{m('stat.gapAt', { time: d.worst.atLabel })}</span>
            </>
          ),
        },
      }),
    ),
    {
      id: 'total',
      label: m('wk.total'),
      cells: { day: <b>{m('wk.total')}</b>, demand: num(roster.weekTotal.demandLabel), capacity: num(roster.weekTotal.capacityLabel), gap: signedNum(roster.weekTotal.gapLabel), worst: null },
    },
  ];

  const hm = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  const rows: RosterRow[] = roster.lines.map((l) => ({
    id: l.id,
    name: l.name,
    sub: `${l.pool ?? '—'} · ${l.shiftName}`,
    subIsData: true,
    blocks: l.onLeave
      ? [{ kind: 'leave', from: l.from, to: l.to, label: m('ro.leave'), tip: `${m('ro.leave')} ${hm(l.from)} - ${hm(l.to)}` }]
      : [
          { kind: 'shift', from: l.from, to: l.to, label: l.shiftName, data: true, tip: `${l.shiftName} ${hm(l.from)} - ${hm(l.to)}` },
          ...(l.breakFrom === null || l.breakTo === null ? [] : [{ kind: 'break' as const, from: l.breakFrom, to: l.breakTo, label: '', tip: m('ro.break', { from: hm(l.breakFrom), to: hm(l.breakTo) }) }]),
        ],
  }));
  if (roster.lines.length > 0) {
    rows.push({
      id: 'gap-row',
      name: m('ro.gap'),
      nameIsData: false,
      sub: m('ro.gapCount', { n: roster.gapIntervals }),
      blocks: roster.gaps.filter((g) => g.to > GRID_START).map((g) => ({ kind: 'gap' as const, from: Math.max(GRID_START, g.from), to: g.to, label: g.shortLabel, data: true, tip: `${hm(g.from)} - ${hm(g.to)}: ${g.shortLabel}` })),
    });
  }

  return (
    <div className={styles.stack}>
      <div className={styles.dayNav}>
        <DayNav dateLabel={roster.dateLabel} prevDate={roster.prevDate} nextDate={roster.nextDate} />
        {roster.lineSource === 'none' ? null : <StatusPill status={roster.lineSource === 'roster' ? m('ro.src.roster') : m('ro.src.home')} tone="neutral" />}
      </div>

      <StatStrip items={stats} />

      <Card padding="none">
        <CardTitle title={m('sh.title')} extra={<IllustrativeLabel />} />
        <AdminTable caption={m('sh.title')} columns={shiftColumns} rows={shiftRows} rowParam={false} pageSize={20} emptyState={<EmptyState compact icon={<Inbox />} title={m('ro.empty')} />} />
      </Card>

      <Card padding="none">
        <CardTitle title={m('wk.title')} extra={<IllustrativeLabel />} />
        <AdminTable caption={m('wk.title')} columns={weekColumns} rows={weekRows} rowParam={false} pageSize={20} />
      </Card>

      <Card padding="none">
        <div className={styles.gridHeader}>
          <h2 className={styles.cardTitle}>{m('ro.title')}</h2>
          <Inline gap={8} align="center" wrap>
            <IllustrativeLabel />
          </Inline>
        </div>
        {roster.poolOptions.length > 1 ? <ListToolbar searchParam={false} filters={[{ key: 'pool', label: m('ro.pool'), options: roster.poolOptions }]} /> : null}
        {roster.lines.length === 0 ? (
          <EmptyState compact icon={<Inbox />} title={m('ro.empty')} />
        ) : (
          <RosterGrid rows={rows} headLabel={t('common.agent')} startHour={GRID_START} endHour={24} stepMin={15} />
        )}
      </Card>
    </div>
  );
}

function PerformancePanel({ perf, m }: { readonly perf: PerformanceView; readonly m: Translate; readonly t: Translate }) {
  const stats: StatItem[] = [
    { label: m('pf.stat.handled'), value: perf.handled },
    { label: m('pf.stat.wait'), value: perf.waitLabel, unit: m('unit.h'), hint: <IllustrativeLabel /> },
    { label: m('pf.stat.complete'), value: perf.completeLabel, unit: m('unit.min'), hint: <IllustrativeLabel /> },
    {
      label: m('pf.stat.util'),
      value: perf.utilizationLabel ?? '—',
      hint: perf.utilizationLabel === null ? <span className={styles.muted}>{m('pf.util.none')}</span> : <IllustrativeLabel />,
    },
  ];

  const typeColumns: AdminTableColumn[] = [
    { key: 'type', header: m('pf.col.type') },
    { key: 'cases', header: m('pf.col.cases'), align: 'end' },
    { key: 'mean', header: m('pf.col.mean'), align: 'end' },
    { key: 'median', header: m('pf.col.median'), align: 'end', hideBelow: 'md' },
    { key: 'r2c', header: m('pf.col.r2c'), align: 'end' },
    { key: 'admin', header: m('pf.col.admin'), hideBelow: 'md' },
  ];
  const typeRows: AdminTableRow[] = perf.caseTypes.map((c) => ({
    id: c.id,
    label: c.label,
    cells: {
      type: <span translate="no">{c.label}</span>,
      cases: num(String(c.cases)),
      mean: (
        <>
          {num(c.meanLabel)} {m('unit.min')}
        </>
      ),
      median: (
        <>
          {num(c.medianLabel)} {m('unit.min')}
        </>
      ),
      r2c: (
        <>
          {num(c.receiptToCloseLabel)} {m('unit.h')}
        </>
      ),
      admin: <Qualifier>{m('pf.notSupplied')}</Qualifier>,
    },
  }));

  const reviewerColumns: AdminTableColumn[] = [
    { key: 'name', header: m('col.reviewer') },
    { key: 'cases', header: m('pf.col.cases'), align: 'end' },
    { key: 'median', header: m('pf.col.median'), align: 'end' },
    { key: 'r2c', header: m('pf.col.r2c'), align: 'end', hideBelow: 'md' },
  ];
  const reviewerRows: AdminTableRow[] = perf.reviewers.map((r) => ({
    id: r.id,
    label: r.name,
    cells: {
      name: <span translate="no">{r.name}</span>,
      cases: num(String(r.cases)),
      median: (
        <>
          {num(r.medianLabel)} {m('unit.min')}
        </>
      ),
      r2c: (
        <>
          {num(r.receiptToCloseLabel)} {m('unit.h')}
        </>
      ),
    },
  }));

  return (
    <div className={styles.stack}>
      <div className={styles.dayNav}>
        <span className={styles.dateRow}>
          <span translate="no">{perf.periodLabel}</span>
          <span>{m('pf.days')}</span>
        </span>
      </div>

      <StatStrip items={stats} />

      <Card padding="lg">
        <div className={styles.cardHeadRow}>
          <div className={styles.cardTitleRow}>
            <h2 className={styles.cardTitle}>{m('pf.hr.title')}</h2>
            <IllustrativeLabel />
          </div>
          <span className={styles.dateRow}>{m('pf.hr.per')}</span>
        </div>
        <PerformanceChart hours={perf.hours} />
      </Card>

      <Card padding="none">
        <CardTitle title={m('pf.ct.title')} extra={<IllustrativeLabel />} />
        <AdminTable caption={m('pf.ct.title')} columns={typeColumns} rows={typeRows} rowParam={false} pageSize={20} />
      </Card>

      <Card padding="none">
        <CardTitle title={m('pf.rv.title')} extra={<IllustrativeLabel />} />
        <AdminTable
          caption={m('pf.rv.title')}
          columns={reviewerColumns}
          rows={reviewerRows}
          rowParam={false}
          pageSize={20}
          emptyState={<EmptyState compact icon={<UserX />} title={m('pf.rv.empty')} />}
        />
      </Card>
    </div>
  );
}
