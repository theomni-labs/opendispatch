// SPDX-License-Identifier: AGPL-3.0-only
import { Card, Inline, StatusPill } from '@opendispatch/ui';
import { date as formatDate, num, weekday } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import type { AdminTableColumn, AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { AdminTable } from '@/components/opendispatch/patterns/AdminTable';
import { StatStrip, type StatItem } from '@/components/opendispatch/patterns/StatStrip';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Link } from '@/i18n/navigation';
import styles from './FieldPlanner.module.css';
import type { FieldPlannerWeekView, WeekCellView } from './view';

// Week view: schedule by center and day, net availability

const TONE: Readonly<Record<string, 'neutral' | 'warning' | 'success'>> = {
  draft: 'neutral',
  rejected: 'neutral',
  building: 'neutral',
  submitted: 'warning',
  approved: 'success',
  published: 'success',
  superseded: 'neutral',
};

export const WEEK_TABS = ['schedule', 'availability'] as const;
export type WeekTab = (typeof WEEK_TABS)[number];

export interface WeekViewProps {
  readonly week: FieldPlannerWeekView;
  readonly tab: WeekTab;
  readonly locale: 'en' | 'ar';
}

export async function WeekView({ week, tab, locale }: WeekViewProps) {
  const m = await getTranslations('ops.field_planner');
  const fmt = (n: number) => num(n, undefined, locale);

  const cell = (c: WeekCellView) => {
    if (c.status === null) return <span className="t-caption">{m(`week.cell.${c.state === 'passed' || c.state === 'too_far' ? c.state : 'none'}`)}</span>;
    return (
      <Link href={c.href} className={styles.weekCell}>
        <StatusPill status={m(`status.${c.status}`)} tone={TONE[c.status] ?? 'neutral'} size="sm" />
        <span className="t-caption">{m('week.cell.n', { n: c.agents, g: c.gaps ?? 0 })}</span>
      </Link>
    );
  };

  const stats: StatItem[] = [
    { label: m('week.stat.rosters'), value: week.stats.built, unit: `/ ${fmt(week.stats.cells)}` },
    { label: m('week.stat.shifts'), value: week.stats.shifts },
    { label: m('stat.gaps'), value: week.stats.gaps, hint: <IllustrativeLabel /> },
    { label: m('week.stat.net'), value: week.stats.netHours, hint: <IllustrativeLabel /> },
  ];

  const scheduleColumns: AdminTableColumn[] = [
    { key: 'center', header: m('week.col.center') },
    ...week.days.map((d): AdminTableColumn => ({
      key: d,
      header: (
        <span className={styles.cellStack}>
          <span>{weekday(d, { locale, length: 'short' })}</span>
          <span className="t-caption" translate="no">
            {formatDate(d, { locale })}
          </span>
        </span>
      ),
    })),
  ];
  const scheduleRows: AdminTableRow[] = week.zones.map((z) => ({
    id: z.id,
    label: z.code,
    cells: {
      center: (
        <span className={styles.cellStack}>
          <b className="t-body-s" translate="no">{z.code}</b>
          <span className="t-caption" translate="no">{z.name}</span>
        </span>
      ),
      ...Object.fromEntries(z.cells.map((c) => [c.date, cell(c)])),
    },
  }));

  const availColumns: AdminTableColumn[] = [
    { key: 'center', header: m('week.col.center') },
    { key: 'shift', header: m('week.col.shift') },
    { key: 'scheduled', header: m('week.col.scheduled'), align: 'end' },
    { key: 'leave', header: m('week.col.leave'), align: 'end', hideBelow: 'md' },
    { key: 'sick', header: m('week.col.sick'), align: 'end', hideBelow: 'md' },
    { key: 'breaks', header: m('week.col.breaks'), align: 'end', hideBelow: 'lg' },
    { key: 'net', header: m('week.col.net'), align: 'end' },
  ];
  const availRows: AdminTableRow[] = week.availability.map((r) => ({
    id: r.id,
    label: `${r.zoneCode} ${r.shiftName}`,
    cells: {
      center: (
        <span className={styles.cellStack}>
          <b className="t-body-s" translate="no">{r.zoneCode}</b>
          <span className="t-caption" translate="no">{r.zoneName}</span>
        </span>
      ),
      shift: (
        <span className={styles.cellStack}>
          <span>{r.shiftName}</span>
          <span className="t-caption">{m('week.avail.n', { n: r.agents })}</span>
        </span>
      ),
      scheduled: <span translate="no">{fmt(r.shiftHours)}</span>,
      leave: <span translate="no">{fmt(r.leaveRestHours)}</span>,
      sick: <span translate="no">{fmt(r.sickHours)}</span>,
      breaks: <span translate="no">{fmt(r.breakPrayerHours)}</span>,
      net: (
        <b translate="no" data-testid="fp-net">
          {fmt(r.netHours)}
        </b>
      ),
    },
  }));

  return (
    <>
      <StatStrip items={stats} />
      <UrlTabs
        id="fpw"
        ariaLabel={m('week.tab.schedule')}
        defaultTab="schedule"
        resetParams={[]}
        tabs={[
          { value: 'schedule', label: m('week.tab.schedule') },
          { value: 'availability', label: m('week.tab.availability') },
        ]}
      />
      <TabPanel id="fpw" value={tab}>
        <Card padding="none">
          {tab === 'schedule' ? (
            <AdminTable caption={m('week.tab.schedule')} columns={scheduleColumns} rows={scheduleRows} rowParam={false} dense />
          ) : (
            <AdminTable caption={m('week.tab.availability')} columns={availColumns} rows={availRows} rowParam={false} dense />
          )}
          <div className={styles.weekFoot}>
            <Inline wrap gap={8} align="center">
              <span className="t-caption">{tab === 'schedule' ? m('week.rules', { days: week.limits.maxDays, hours: week.limits.maxHours }) : m('week.avail.unit')}</span>
              <IllustrativeLabel />
            </Inline>
          </div>
        </Card>
      </TabPanel>
    </>
  );
}
