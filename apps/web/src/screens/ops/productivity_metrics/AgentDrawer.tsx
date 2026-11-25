'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, DescriptionList, Drawer } from '@opendispatch/ui';
import { BarChart } from '@opendispatch/ui/charts';
import { date, duration, formatPercent } from '@opendispatch/ui/format';
import { useTranslations } from 'next-intl';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import styles from './ProductivityMetrics.module.css';
import type { DrawerView } from './view';

// Agent detail (#pm-drawer), read only

export interface AgentDrawerProps {
  readonly target: DrawerView | undefined;
  readonly locale: 'en' | 'ar';
}

export function AgentDrawer({ target, locale }: AgentDrawerProps) {
  const m = useTranslations('ops.productivity_metrics');
  const t = useTranslations();
  const url = useUrlState();
  const close = () => url.update({ agent: null });

  const days = target?.days ?? [];
  const chartData = days.map((d) => ({
    label: String(Number(d.date.slice(8, 10))),
    values: [Math.round((d.assignedSeconds ?? 0) / 6) / 10, Math.round((d.onSceneSeconds ?? 0) / 6) / 10] as [number, number],
  }));

  const weekColumns: AdminTableColumn[] = [
    { key: 'day', header: m('drawer.day') },
    { key: 'cases', header: m('th.cases'), align: 'end' },
    { key: 'a', header: m('drawer.toScene'), align: 'end' },
    { key: 's', header: m('drawer.onScene'), align: 'end' },
  ];
  const weekRows: AdminTableRow[] = days.map((d) => ({
    id: d.date,
    cells: {
      day: <span translate="no">{date(d.date, { locale })}</span>,
      cases: <span translate="no">{d.cases}</span>,
      a: <span translate="no">{d.cases === 0 ? '—' : duration(d.assignedSeconds, 'clock')}</span>,
      s: <span translate="no">{d.cases === 0 ? '—' : duration(d.onSceneSeconds, 'clock')}</span>,
    },
  }));

  return (
    <Drawer
      open={target !== undefined}
      onClose={close}
      title={target?.name ?? ''}
      subtitle={
        target === undefined ? undefined : (
          <span dir="ltr" translate="no">
            {target.code} · {target.zoneLabel}
          </span>
        )
      }
      footer={
        <Button variant="secondary" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      {target === undefined ? null : (
        <div className={styles.drawerStack}>
          <DescriptionList
            dense
            columns={2}
            items={[
              { label: m('th.cases'), value: <span translate="no">{target.cases}</span> },
              { label: m('fromAssignment'), value: <span translate="no">{duration(target.assignedSeconds, 'clock')}</span> },
              { label: m('fromRegistration'), value: <span translate="no">{duration(target.registeredSeconds, 'clock')}</span> },
              { label: m('th.onScene'), value: <span translate="no">{duration(target.onSceneSeconds, 'clock')}</span> },
              { label: m('th.util'), value: <span translate="no">{formatPercent(target.utilisation, locale)}</span> },
              { label: m('drawer.zoneMedian'), value: <span translate="no">{duration(target.zoneMedianSeconds, 'clock')}</span> },
            ]}
          />
          <div className={styles.cardTitleRow}>
            <h3 className={styles.cardTitle}>{m('drawer.week')}</h3>
          </div>
          <BarChart
            data={chartData}
            series={[
              { name: m('drawer.toScene'), color: 'var(--od-chart-1)' },
              { name: m('drawer.onScene'), color: 'var(--od-chart-4)' },
            ]}
            height={200}
            label={m('drawer.week')}
          />
          <AdminTable columns={weekColumns} rows={weekRows} caption={m('drawer.week')} rowParam={false} pageSize={0} dense />
        </div>
      )}
    </Drawer>
  );
}
