// SPDX-License-Identifier: AGPL-3.0-only
import { Card } from '@opendispatch/ui';
import { getTranslations } from 'next-intl/server';
import { HeaderActions, NewRequestButton } from './HeaderActions';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip, type StatItem } from '@/components/opendispatch/patterns/StatStrip';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { LeaveWindowsCalendar } from './LeaveWindowsCalendar';
import styles from './LeavePlanner.module.css';
import { NewRequestModal } from './NewRequestModal';
import { RequestDrawer } from './RequestDrawer';
import { RequestsTable } from './RequestsTable';
import { LEAVE_STATUSES, LEAVE_TYPES, REMOTE_ZONE_VALUE } from './types';
import { loadLeavePlannerView, TABLE_PAGE_SIZE } from './view';
import { AxisStartScroll } from '@/components/opendispatch/AxisStartScroll';
import { loadLeaveOutlookView } from './outlook';
import { OUTLOOK_HORIZONS } from './outlook-types';
import { OutlookCard } from './OutlookCard';

// Leave Planner (Ops 9, flow 3

const LEGEND: readonly { readonly key: string; readonly color: string }[] = [
  { key: 'win.demand', color: 'var(--od-chart-6)' },
  { key: 'status.approved', color: 'var(--od-color-info)' },
  { key: 'status.requested', color: 'var(--od-color-warning)' },
  { key: 'win.rec', color: 'var(--od-color-success)' },
];

export async function LeavePlannerScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.leave_planner');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<HeaderActions canEdit={canEdit} />} emptyAction={<NewRequestButton canEdit={canEdit} variant="secondary" />} />;
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(LEAVE_STATUSES),
    zone: param.pattern(/^[A-Za-z0-9-]{1,16}$/, 16),
    type: param.enum(LEAVE_TYPES),
    q: param.text(80),
    id: param.id(),
    new: param.flag(),
    page: param.int(1, 1000),
    horizon: param.enum(OUTLOOK_HORIZONS),
  });
  const view = await loadLeavePlannerView(ctx, query, locale);

  if (view.isEmpty) {
    return (
      <>
        <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={m('sub')} actions={<HeaderActions canEdit={canEdit} />} isEmpty emptyAction={<NewRequestButton canEdit={canEdit} variant="secondary" />} />
        <NewRequestModal open={query.new === true} canEdit={canEdit} candidates={view.candidates} />
      </>
    );
  }

  const outlook = await loadLeaveOutlookView(ctx, query.horizon === '52' ? 52 : 13, locale);
  const sources = [...new Set([...view.sources, ...outlook.sources])];
  const tab = query.tab ?? 'requested';
  const stats: StatItem[] = [
    { label: m('stat.pending'), value: view.stats.pending },
    { label: m('stat.approved'), value: view.stats.approved },
    { label: m('stat.gaps'), value: view.stats.newGapsIfApproved, hint: <IllustrativeLabel /> },
    { label: m('stat.windows'), value: view.stats.recommendedWindows, hint: <IllustrativeLabel /> },
  ];

  const tabs = (
    <UrlTabs
      id="lp"
      ariaLabel={m('tabs.label')}
      defaultTab="requested"
      tabs={[
        { value: 'requested', label: m('status.requested'), count: view.counts.requested },
        { value: 'approved', label: m('status.approved'), count: view.counts.approved },
        { value: 'declined', label: m('status.declined'), count: view.counts.declined },
      ]}
    />
  );

  const zoneOptions = [...view.zoneOptions, { value: REMOTE_ZONE_VALUE, label: t('scopes.remote_pool') }];

  return (
    <ScreenFrame def={def} access={access} homeHref={homeHref} sources={sources} description={m('sub')} tabs={tabs} actions={<HeaderActions canEdit={canEdit} />}>
      <div className={styles.stack}>
        <StatStrip items={stats} />

        <Card padding="none">
          <div className={styles.cardHeadRow}>
            <h2 className={styles.cardTitle}>{m('req.title')}</h2>
          </div>
          <ListToolbar
            searchLabel={m('search')}
            filters={[
              { key: 'zone', label: t('common.zone'), options: zoneOptions },
              { key: 'type', label: m('filter.type'), options: LEAVE_TYPES.map((type) => ({ value: type, label: m(`type.${type}`) })) },
            ]}
          />
          <TabPanel id="lp" value={tab}>
            <RequestsTable rows={view.rows} canEdit={canEdit} pageSize={TABLE_PAGE_SIZE} page={query.page} />
          </TabPanel>
        </Card>

        <Card padding="lg">
          <div className={styles.cardHeadRow}>
            <div className={styles.inline}>
              <h2 className={styles.cardTitle}>{m('win.title')}</h2>
              <IllustrativeLabel />
            </div>
            <ul className={styles.legend}>
              {LEGEND.map((item) => (
                <li key={item.key} className={styles.legendItem}>
                  <i className={styles.legendSwatch} style={{ background: item.color }} />
                  <span>{m(item.key)}</span>
                </li>
              ))}
            </ul>
          </div>
          <AxisStartScroll className={styles.scrollX}>
            <LeaveWindowsCalendar windows={view.windows} />
          </AxisStartScroll>
        </Card>

        <OutlookCard outlook={outlook} />
      </div>

      <RequestDrawer row={view.drawer} canEdit={canEdit} />
      <NewRequestModal open={query.new === true} canEdit={canEdit} candidates={view.candidates} />
    </ScreenFrame>
  );
}
