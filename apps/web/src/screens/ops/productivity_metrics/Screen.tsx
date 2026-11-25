// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Card, Stat } from '@opendispatch/ui';
import { date, duration, formatPercent, int, num } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { Reading, type ReadingItem } from '@/components/opendispatch/Reading';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { clockOrder } from './clock';
import { DistributionsCard } from './DistributionsCard';
import { HeaderActions } from './HeaderActions';
import styles from './ProductivityMetrics.module.css';
import { ProductivityHeat } from './ProductivityHeat';
import { AgentDrawer } from './AgentDrawer';
import { CASES_FILTER_VALUES, CLOCK_VALUES, SORT_COLUMNS, SPEED_FILTER_VALUES } from './types';
import { loadProductivityMetricsView, type AgentRow } from './view';
import { isolateLtr } from '@/components/opendispatch/isolateLtr';

// Productivity and Metrics (module 12), read only

// The 10-minute threshold of the reading titles
const TARGET_MINUTES = 10;

export async function ProductivityMetricsScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.productivity_metrics');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<HeaderActions />} />;
  }

  const query = parseSearchParams(searchParams, {
    zone: param.id(),
    clock: param.enum(CLOCK_VALUES),
    q: param.text(80),
    fzone: param.id(),
    fcases: param.enum(CASES_FILTER_VALUES),
    fspeed: param.enum(SPEED_FILTER_VALUES),
    sort: param.sort(SORT_COLUMNS),
    page: param.int(1, 1000),
    agent: param.id(),
  });

  const view = await loadProductivityMetricsView(ctx, query, locale);
  const actions = <HeaderActions />;

  if (view.isEmpty) {
    return <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} actions={actions} isEmpty />;
  }

  const description = <span translate="no">{m('sub', { from: date(view.periodStart, { locale }), to: date(view.periodEnd, { locale }) })}</span>;

  const readingItems: ReadingItem[] = (['from_assignment', 'from_registration'] as const)
    .map((key) => {
      const seconds = key === view.reading.primaryKey ? view.reading.primarySeconds : view.reading.secondarySeconds;
      return {
        label: key === 'from_assignment' ? m('fromAssignment') : m('fromRegistration'),
        value: <bdi dir="ltr">{duration(seconds, 'clock')}</bdi>,
        unit: t('common.minShort'),
        primary: key === view.reading.primaryKey,
        illustrative: true,
      };
    })
    .sort((a, b) => Number(b.primary) - Number(a.primary));

  const lead = view.reading.primaryKey === 'from_registration' ? 'r' : 'a';
  const columns: AdminTableColumn[] = [
    { key: 'name', header: t('common.agent'), sortable: true },
    { key: 'zone', header: t('common.zone'), hideBelow: 'md', sortable: true },
    { key: 'cases', header: m('th.cases'), align: 'end', sortable: true },
    ...clockOrder(lead).map((key, i): AdminTableColumn => ({ key, header: m(key === 'a' ? 'fromAssignment' : 'fromRegistration'), align: 'end', sortable: true, ...(i === 0 ? {} : { hideBelow: 'md' as const }) })),
    { key: 's', header: m('th.onScene'), align: 'end', hideBelow: 'md', sortable: true },
    { key: 'u', header: m('th.util'), align: 'end', hideBelow: 'md', sortable: true },
  ];

  const rowOf = (row: AgentRow): AdminTableRow => ({
    id: row.id,
    label: row.name,
    sort: { name: row.name, zone: row.zoneCode, cases: row.cases, a: row.assignedSeconds ?? -1, r: row.registeredSeconds ?? -1, s: row.onSceneSeconds ?? -1, u: row.utilisation ?? -1 },
    cells: {
      name: (
        <span>
          <span className={styles.cellMain} translate="no">
            {row.name}
          </span>
          <span className={styles.cellSub} translate="no">
            {row.code}
          </span>
        </span>
      ),
      zone: <span translate="no">{row.zoneCode}</span>,
      cases: <span translate="no">{row.cases}</span>,
      a: lead === 'a' ? <b translate="no">{duration(row.assignedSeconds, 'clock')}</b> : <span translate="no">{duration(row.assignedSeconds, 'clock')}</span>,
      r: lead === 'r' ? <b translate="no">{duration(row.registeredSeconds, 'clock')}</b> : <span translate="no">{duration(row.registeredSeconds, 'clock')}</span>,
      s: <span translate="no">{duration(row.onSceneSeconds, 'clock')}</span>,
      u: <span translate="no">{formatPercent(row.utilisation, locale)}</span>,
    },
  });

  const zoneColumns: AdminTableColumn[] = [
    { key: 'zone', header: t('common.zone') },
    { key: 'cases', header: m('th.cases'), align: 'end', hideBelow: 'md' },
    { key: 'toScene', header: m('zones.toScene'), align: 'end' },
    { key: 'onScene', header: m('th.onScene'), align: 'end', hideBelow: 'md' },
    { key: 'admin', header: m('zones.admin'), align: 'end' },
    { key: 'perShift', header: m('zones.perShift'), align: 'end' },
  ];
  const zoneRows: AdminTableRow[] = view.zoneRows.map((row) => ({
    id: row.zoneId,
    label: row.code,
    cells: {
      zone: (
        <span>
          <span className={styles.cellMain} translate="no">
            {row.name}
          </span>
          <span className={styles.cellSub} translate="no">
            {row.code}
          </span>
        </span>
      ),
      cases: <span translate="no">{int(row.cases, locale)}</span>,
      toScene: <b translate="no">{duration(row.toSceneSeconds, 'clock')}</b>,
      onScene: <span translate="no">{duration(row.onSceneSeconds, 'clock')}</span>,
      admin: <span translate="no">{duration(row.adminSeconds, 'clock')}</span>,
      perShift: <span translate="no">{row.casesPerShift === null ? '—' : num(row.casesPerShift, 1, locale)}</span>,
    },
  }));

  return (
    <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={description} actions={actions}>
      <div className={styles.stack}>
        <div className={styles.headGrid}>
          <Stat label={m('cases')} value={<bdi translate="no">{int(view.stats.cases, locale)}</bdi>} hint={<IllustrativeLabel />} />
          <Stat label={m('agents')} value={<bdi translate="no">{int(view.stats.agents, locale)}</bdi>} hint={<IllustrativeLabel />} />
          <Stat
            label={m('onSceneMedian')}
            value={<bdi translate="no">{duration(view.stats.onSceneMedianSeconds, 'clock')}</bdi>}
            unit={t('common.minShort')}
            hint={<IllustrativeLabel />}
          />
          <div className={styles.readCard}>
            <div className={styles.cardTitleRow}>
              <h2 className="t-caption text-label">{m('read.title')}</h2>
              <IllustrativeLabel />
              {view.reading.targetShare === null ? null : (
                <Badge className={styles.targetBadge}>{m('read.target', { pct: isolateLtr(formatPercent(view.reading.targetShare, locale)), min: TARGET_MINUTES })}</Badge>
              )}
            </div>
            <Reading items={readingItems} compact />
          </div>
        </div>

        <DistributionsCard zoneOptions={view.zoneOptions} zone={view.zone} clock={view.clock} defaultClock={lead} toScene={view.toScene} onScene={view.onScene} />

        <Card padding="lg">
          <div className={styles.cardHeadRow}>
            <h2 className={styles.cardTitle}>{m('heat.title')}</h2>
            <IllustrativeLabel />
          </div>
          <ProductivityHeat heat={view.heat} />
        </Card>

        <Card padding="none">
          <div className={styles.tableHead}>
            <div className={styles.cardTitleRow}>
              <h2 className={styles.cardTitle}>{m('zones.title')}</h2>
              <IllustrativeLabel />
            </div>
          </div>
          <AdminTable columns={zoneColumns} rows={zoneRows} caption={m('zones.title')} pageSize={0} />
        </Card>

        <Card padding="none">
          <div className={styles.tableHead}>
            <div className={styles.cardTitleRow}>
              <h2 className={styles.cardTitle}>{m('tbl.title')}</h2>
              <IllustrativeLabel />
            </div>
          </div>
          <ListToolbar
            searchLabel={m('search')}
            filters={[
              { key: 'fzone', label: t('common.zone'), options: view.zoneOptions },
              {
                key: 'fcases',
                label: m('th.cases'),
                options: [
                  { value: 'hi', label: m('f.cases.hi') },
                  { value: 'lo', label: m('f.cases.lo') },
                ],
              },
              {
                key: 'fspeed',
                label: m('f.speedLabel'),
                options: [
                  { value: 'fast', label: m('f.speed.fast') },
                  { value: 'slow', label: m('f.speed.slow') },
                ],
              },
            ]}
          />
          <AdminTable
            columns={columns}
            rows={view.rows.map(rowOf)}
            caption={m('tbl.title')}
            rowParam="agent"
            sort={view.sort}
            page={query.page}
            emptyState={<NoMatch title={m('none.title')} clearParams={['q', 'fzone', 'fcases', 'fspeed']} />}
          />
        </Card>
      </div>

      <AgentDrawer target={view.drawer} locale={locale} />
    </ScreenFrame>
  );
}
