'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Card, DescriptionList, useFormat } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { DataSourceBadge } from '@/components/opendispatch/DataSourceBadge';
import type { AssumptionsView } from './types';
import styles from './ForecastModel.module.css';

// Mockup admin-forecast-model.html, `#fm-a-title`.

export function AssumptionsCard({ assumptions: a }: { assumptions: AssumptionsView }) {
  const m = useTranslations('admin.forecast_model');
  const format = useFormat();
  const tagged = (value: ReactNode, confirmed: boolean) => (
    <span className={styles.inline}>
      {value}
      <Badge tone={confirmed ? 'success' : 'warning'} size="sm">
        {m(confirmed ? 'a.confirmed' : 'a.assumption')}
      </Badge>
    </span>
  );
  const kmh = (n: number) => <bdi translate="no">{m('a.kmh', { n: format.formatNumber(n, { maximumFractionDigits: 1 }) })}</bdi>;
  const wx = a.weather;
  const range =
    wx.from === null || wx.to === null ? null : (
      <span className={styles.meta}>
        <bdi translate="no">{m('a.wxRange', { cities: format.int(wx.cities), from: format.date(wx.from), to: format.date(wx.to) })}</bdi>
      </span>
    );
  const weather =
    wx.source === 'none' ? (
      m('a.wxNone')
    ) : (
      <span className={styles.stackXs}>
        <span translate={wx.attribution === null ? undefined : 'no'}>{wx.attribution ?? m(wx.source === 'feed' ? (a.weatherFeed === 'synthetic' ? 'a.wxSynthetic' : 'a.wxFeed') : 'a.wxStored')}</span>
        {range}
      </span>
    );
  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h2 className={styles.cardTitle}>{m('a.title')}</h2>
        </div>
        <DescriptionList
          dense
          columns={1}
          items={[
            { label: m('a.liveSpeed'), value: tagged(kmh(a.liveSpeedKmh), false) },
            { label: m('a.planSpeed'), value: tagged(kmh(a.planningSpeedKmh), false) },
            { label: m('m.clock'), value: tagged(m(a.clockStart === 'assignment' ? 'm.fromAssignment' : 'm.fromRegistration'), a.clockConfirmed) },
            { label: m('a.payday'), value: tagged(a.paydayDay === 0 ? m('a.off') : m('a.day', { n: format.int(a.paydayDay) }), false) },
            { label: m('a.handling'), value: a.handlingInferred ? tagged(m('a.inferred'), false) : m('a.supplied') },
            { label: m('a.history'), value: a.caseSources.length === 0 ? '-' : <DataSourceBadge sources={a.caseSources} /> },
            { label: m('a.weather'), value: weather },
            { label: m('a.traffic'), value: a.trafficSource === 'none' ? m('a.trNone') : tagged(m(a.trafficSource === 'file' ? 'a.trFile' : 'a.trSynthetic'), false) },
          ]}
        />
      </div>
    </Card>
  );
}
