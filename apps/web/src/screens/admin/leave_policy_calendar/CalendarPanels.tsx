'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, CardHeader, IconButton, SegmentedControl, Switch, Tag, useFormat } from '@opendispatch/ui';
import { ChevronLeft, ChevronRight, Moon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import type { SortParam } from '@/components/opendispatch/patterns/search-params';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { MonthGrid } from '@/components/opendispatch/MonthGrid';
import type { HolidayRow, MonthView, PrayerRow, RamadanMarker } from './types';
import styles from './LeavePolicyCalendar.module.css';

// The Calendar, Holidays and Prayer times panels (client files: the design system's DataTable takes functions, so the Server
// Component hands these plain data, ). The month, the calendar and the day live in the address (`?cal=`, `?month=`,
// `?date=`), so a link opens the same view; the two switches under the grid are view choices only. Nothing here reads a context
// or the caller's role.

const KIND_COLOR = { public: 'geekblue', religious: 'green', observance: 'gold' } as const;

export interface CalendarPanelProps {
  readonly month: MonthView;
  readonly ramadan: RamadanMarker | null;
  /** The month's title and the other calendar's span under it, in the reader's language. */
  readonly title: string;
  readonly subtitle: string;
  readonly weekdays: readonly string[];
}

export function CalendarPanel({ month, ramadan, title, subtitle, weekdays }: CalendarPanelProps) {
  const m = useTranslations('admin.leave_policy_calendar');
  const format = useFormat();
  const url = useUrlState();
  const [hijri, setHijri] = useState(true);
  const [marked, setMarked] = useState(true);

  return (
    <Card padding="lg">
      <div className={styles.stack}>
        <div className={styles.calHead}>
          <div className={styles.calTitle}>
            <h2 className={styles.cardTitle}>{title}</h2>
            <span className={styles.meta} translate="no">
              {subtitle}
            </span>
          </div>
          <SegmentedControl
            size="sm"
            ariaLabel={m('cal.label')}
            value={month.mode}
            options={[
              { value: 'gregorian', label: m('cal.gregorian') },
              { value: 'hijri', label: m('cal.hijri') },
            ]}
            onChange={(next) => url.update({ cal: next === 'hijri' ? 'hijri' : null, month: null }, { history: 'replace', keepPage: true })}
          />
          <div className={styles.nav}>
            <span className={styles.flip}>
              <IconButton variant="secondary" size="sm" icon={<ChevronLeft />} label={m('prevMonth')} aria-disabled={month.prev === null || undefined} onClick={() => month.prev !== null && url.update({ month: month.prev }, { history: 'replace', keepPage: true })} />
            </span>
            <Button variant="secondary" size="sm" onClick={() => url.update({ month: null }, { history: 'replace', keepPage: true })}>
              {m('today')}
            </Button>
            <span className={styles.flip}>
              <IconButton variant="secondary" size="sm" icon={<ChevronRight />} label={m('nextMonth')} aria-disabled={month.next === null || undefined} onClick={() => month.next !== null && url.update({ month: month.next }, { history: 'replace', keepPage: true })} />
            </span>
          </div>
        </div>
        {ramadan === null ? null : (
          <div>
            <Button variant="secondary" size="sm" startIcon={<Moon />} onClick={() => url.update({ month: month.mode === 'hijri' ? ramadan.hijriKey : ramadan.gregorianKey }, { history: 'replace', keepPage: true })}>
              {m('ramadan.markerYear', { year: ramadan.hijriYear })}
              <span className={`${styles.muted} ${styles.rangeAfterLabel}`} translate="no">{`${format.date(ramadan.from)} - ${format.date(ramadan.to)}`}</span>
            </Button>
          </div>
        )}
        <MonthGrid
          label={title}
          weekdays={weekdays}
          weeks={month.weeks}
          showSecondary={hijri}
          markRamadan={marked}
          todayLabel={m('legend.today')}
          ramadanLabel={m('legend.ramadan')}
          onSelect={(id) => url.update({ holiday: id }, { history: 'push', keepPage: true })}
        />
        <div className={styles.legendRow}>
          <ul className={styles.legend}>
            <li className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swToday}`} />
              {m('legend.today')}
            </li>
            <li className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swRamadan}`} />
              {m('legend.ramadan')}
            </li>
            <li className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swHoliday}`} />
              {m('legend.holiday')}
            </li>
          </ul>
          <span className={styles.push} />
          <Switch checked={hijri} label={month.mode === 'hijri' ? m('sw.gregorian') : m('sw.hijri')} onCheckedChange={setHijri} />
          <Switch checked={marked} label={m('sw.ramadan')} onCheckedChange={setMarked} />
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------------------------

export interface HolidaysTableProps {
  readonly rows: readonly HolidayRow[];
  readonly caption: string;
  readonly emptyState: ReactNode;
  readonly sort?: SortParam | undefined;
  readonly page?: number | undefined;
}

export function HolidaysTable({ rows, caption, emptyState, sort, page }: HolidaysTableProps) {
  const m = useTranslations('admin.leave_policy_calendar');
  const format = useFormat();
  const range = (from: string, to: string, calendar?: 'hijri') => (from === to ? format.date(from, calendar === undefined ? {} : { calendar }) : `${format.date(from, calendar === undefined ? {} : { calendar })} - ${format.date(to, calendar === undefined ? {} : { calendar })}`);
  const columns: AdminTableColumn[] = [
    { key: 'name', header: m('col.holiday'), sortable: true },
    { key: 'kind', header: m('col.type') },
    { key: 'gregorian', header: m('col.gregorian'), sortable: true },
    { key: 'hijri', header: m('col.hijri'), hideBelow: 'md' },
    { key: 'days', header: m('col.days'), align: 'end' },
  ];
  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: row.id,
    label: row.nameEn,
    sort: { name: row.nameEn, gregorian: row.from },
    cells: {
      name: (
        <>
          <span className={styles.cellMain} translate="no">
            {row.nameEn}
          </span>
          {row.nameAr === null ? null : (
            <span className={styles.cellSub} lang="ar" dir="rtl">
              {row.nameAr}
            </span>
          )}
        </>
      ),
      kind: <Tag color={KIND_COLOR[row.kind]}>{m(`kind.${row.kind}`)}</Tag>,
      gregorian: <span translate="no">{range(row.from, row.to)}</span>,
      hijri: <span translate="no">{range(row.from, row.to, 'hijri')}</span>,
      days: <bdi translate="no">{format.int(row.days)}</bdi>,
    },
  }));
  return <AdminTable caption={caption} columns={columns} rows={tableRows} rowParam="holiday" emptyState={emptyState} sort={sort} page={page} />;
}

// ---------------------------------------------------------------------------------------------
// Prayer times
// ---------------------------------------------------------------------------------------------

export interface PrayerPanelProps {
  readonly date: string;
  readonly prev: string;
  readonly next: string;
  readonly rows: readonly PrayerRow[];
  readonly storedRange: { readonly from: string; readonly to: string } | null;
}

export function PrayerPanel({ date, prev, next, rows, storedRange }: PrayerPanelProps) {
  const m = useTranslations('admin.leave_policy_calendar');
  const format = useFormat();
  const url = useUrlState();
  const allStored = rows.length > 0 && rows.every((r) => r.stored);
  const columns: AdminTableColumn[] = [
    { key: 'city', header: m('p.city') },
    ...(['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const).map((key) => ({ key, header: m(`p.${key}`), align: 'end' as const })),
  ];
  const time = (value: string | null) => <bdi dir="ltr" translate="no">{value ?? '-'}</bdi>;
  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: row.cityId,
    label: row.cityName,
    cells: { city: <span translate="no">{row.cityName}</span>, fajr: time(row.fajr), sunrise: time(row.sunrise), dhuhr: time(row.dhuhr), asr: time(row.asr), maghrib: time(row.maghrib), isha: time(row.isha) },
  }));
  return (
    <Card padding="none">
      <CardHeader
        title={m('p.title')}
        actions={
          <span className={styles.badges}>
            <Badge tone="neutral" size="sm">
              {m('p.method')}
            </Badge>
            <Badge tone="info" size="sm">
              {m(allStored ? 'p.stored' : 'p.computed')}
            </Badge>
          </span>
        }
      />
      <div className={styles.dayNav}>
        <span className={styles.flip}>
          <IconButton variant="secondary" size="sm" icon={<ChevronLeft />} label={m('p.prev')} onClick={() => url.update({ date: prev }, { history: 'replace', keepPage: true })} />
        </span>
        <span className={styles.cellMain} translate="no">
          {format.dateBoth(date)}
        </span>
        <span className={styles.flip}>
          <IconButton variant="secondary" size="sm" icon={<ChevronRight />} label={m('p.next')} onClick={() => url.update({ date: next }, { history: 'replace', keepPage: true })} />
        </span>
      </div>
      <AdminTable caption={m('p.title')} columns={columns} rows={tableRows} rowParam={false} pageSize={0} />
      {storedRange === null ? null : <div className={styles.summary}>{m('p.range', { from: format.date(storedRange.from), to: format.date(storedRange.to) })}</div>}
    </Card>
  );
}
