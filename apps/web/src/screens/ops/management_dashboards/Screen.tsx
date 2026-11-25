// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Card, Stat, StatusPill } from '@opendispatch/ui';
import { duration, formatPercent, int, num } from '@opendispatch/ui/format';
import { Eye, Lightbulb, Zap, type LucideIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { Reading, type ReadingItem } from '@/components/opendispatch/Reading';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { CompareChart } from './CompareChart';
import { HeaderActions } from './HeaderActions';
import styles from './ManagementDashboards.module.css';
import { ScopeSwitcher } from './ScopeSwitcher';
import { TrendChart } from './TrendChart';
import { SCOPE_VALUES, type StageValue } from './types';
import { loadManagementDashboardsView } from './view';
import { isolateLtr } from '@/components/opendispatch/isolateLtr';

// Management Dashboards (module 11)

const STAGE_ICON: Readonly<Record<StageValue, LucideIcon>> = { shadow: Eye, recommend: Lightbulb, automatic: Zap };
const READ_KEYS = ['fromAssignment', 'fromRegistration'] as const;

export async function ManagementDashboardsScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.management_dashboards');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<HeaderActions />} />;
  }

  const query = parseSearchParams(searchParams, {
    scope: param.enum(SCOPE_VALUES),
    city: param.id(),
    zone: param.id(),
  });

  const view = await loadManagementDashboardsView(ctx, query, locale);
  const description = m('sub', { date: view.dayLabel });
  const actions = <HeaderActions />;

  if (view.isEmpty) {
    return <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={description} actions={actions} isEmpty />;
  }

  const primaryIsAssignment = view.stats.clockStart === 'assignment';
  const readingItems: ReadingItem[] = READ_KEYS.map((key) => {
    const share = key === 'fromAssignment' ? view.stats.assignShare : view.stats.registerShare;
    const primary = (key === 'fromAssignment') === primaryIsAssignment;
    return { label: m(`read.${key}`), value: formatPercent(share, locale), primary, illustrative: true };
  }).sort((a, b) => Number(b.primary) - Number(a.primary));

  const compareTitle = view.compareIsCities ? m('cmp.cities') : m('cmp.zones');

  const zoneColumns: AdminTableColumn[] = [
    { key: 'zone', header: t('common.zone') },
    { key: 'stage', header: m('col.stage'), hideBelow: 'md' },
    { key: 'cases', header: m('col.cases'), align: 'end', hideBelow: 'md' },
    { key: 'field', header: m('col.field'), align: 'end', hideBelow: 'md' },
    { key: 'onShift', header: m('stat.onShift'), align: 'end', hideBelow: 'md' },
    { key: 'assign', header: m('read.fromAssignment'), align: 'end' },
    { key: 'register', header: m('read.fromRegistration'), align: 'end' },
  ];

  const zoneRows: AdminTableRow[] = view.zoneRows.map((row) => {
    const Icon = STAGE_ICON[row.stage];
    const assign = <span translate="no">{formatPercent(row.assignShare, locale)}</span>;
    const register = <span translate="no">{formatPercent(row.registerShare, locale)}</span>;
    return {
      id: row.zoneId,
      label: row.code,
      tone: row.selected ? 'info' : undefined,
      href: row.href,
      cells: {
        zone: (
          <span className={styles.cellStack}>
            <span className={styles.cellMain} translate="no">
              {row.name}
            </span>
            <span className={styles.cellSub} translate="no">
              {row.code}
            </span>
          </span>
        ),
        stage: (
          <span className={styles.stageCell}>
            <Icon className={styles.stageIcon} aria-hidden="true" />
            {t(`opendispatch.stage.${row.stage}`)}
          </span>
        ),
        cases: <span translate="no">{int(row.cases, locale)}</span>,
        field: <span translate="no">{int(row.field, locale)}</span>,
        onShift: <span translate="no">{int(row.onShift, locale)}</span>,
        assign: primaryIsAssignment ? <b translate="no">{formatPercent(row.assignShare, locale)}</b> : assign,
        register: primaryIsAssignment ? register : <b translate="no">{formatPercent(row.registerShare, locale)}</b>,
      },
    };
  });

  const planColumns: AdminTableColumn[] = [
    { key: 'zone', header: t('common.zone') },
    { key: 'short', header: m('plan.short'), align: 'end' },
    { key: 'windows', header: m('plan.windows'), align: 'end' },
    { key: 'longest', header: m('plan.longest'), align: 'end' },
    { key: 'hours', header: m('plan.hours'), align: 'end', hideBelow: 'md' },
    { key: 'overrides', header: m('plan.overrides'), align: 'end' },
  ];
  const overrideTarget = view.plan?.overrideTarget ?? 0.05;
  const planRows: AdminTableRow[] = (view.plan?.rows ?? []).map((row) => ({
    id: row.zoneId,
    label: row.code,
    cells: {
      zone: (
        <span className={styles.cellStack}>
          <span className={styles.cellMain} translate="no">
            {row.name}
          </span>
          <span className={styles.cellSub} translate="no">
            {row.code}
          </span>
        </span>
      ),
      short:
        row.shortHours !== null && row.shortHours > 0 ? (
          <StatusPill status={num(row.shortHours, 1, locale)} tone="danger" size="sm" />
        ) : (
          <span translate="no">{row.shortHours === null ? '—' : num(row.shortHours, 1, locale)}</span>
        ),
      windows: <span translate="no">{int(row.windows, locale)}</span>,
      longest: <span translate="no">{`${duration(row.longestMinutes, 'clock')} ${m('plan.h')}`}</span>,
      hours: <span translate="no">{num(row.surplusHours, 1, locale)}</span>,
      overrides:
        row.overrideShare !== null && row.overrideShare > overrideTarget ? (
          <StatusPill status={formatPercent(row.overrideShare, locale, 1)} tone="warning" size="sm" />
        ) : (
          <span translate="no">{formatPercent(row.overrideShare, locale, 1)}</span>
        ),
    },
  }));

  const utilColumns: AdminTableColumn[] = [
    { key: 'zone', header: t('common.zone') },
    ...(view.util?.shiftCodes ?? []).map((code): AdminTableColumn => ({ key: `s:${code}`, header: code, align: 'end', hideBelow: 'md' })),
    { key: 'all', header: m('util.all'), align: 'end' },
    { key: 'base', header: m('util.baseline'), align: 'end', hideBelow: 'md' },
    { key: 'change', header: m('util.change'), align: 'end' },
  ];
  const targetPoints = view.util?.targetPoints ?? 10;
  const pts = (v: number | null): string => {
    if (v === null) return '—';
    const r = Math.round(v * 10) / 10;
    return `${r > 0 ? '+' : r < 0 ? '−' : ''}${num(Math.abs(r), 1, locale)} ${m('util.pts')}`;
  };
  const utilRows: AdminTableRow[] = (view.util?.rows ?? []).map((row) => ({
    id: row.zoneId,
    label: row.code,
    cells: {
      zone: (
        <span className={styles.cellStack}>
          <span className={styles.cellMain} translate="no">
            {row.name}
          </span>
          <span className={styles.cellSub} translate="no">
            {row.code}
          </span>
        </span>
      ),
      ...Object.fromEntries(
        (view.util?.shiftCodes ?? []).map((code) => [
          `s:${code}`,
          <span key={code} className={styles.cellStack}>
            <span className={styles.cellMain} translate="no">
              {formatPercent(row.shifts[code] ?? null, locale, 1)}
            </span>
            <span className={styles.cellSub} translate="no">
              <bdi dir="ltr">{pts(row.shiftChanges[code] ?? null)}</bdi>
            </span>
          </span>,
        ]),
      ),
      all: <b translate="no">{formatPercent(row.share, locale, 1)}</b>,
      base: <span translate="no">{formatPercent(row.baselineShare, locale, 1)}</span>,
      change:
        row.changePoints !== null && row.changePoints >= targetPoints ? (
          <StatusPill status={pts(row.changePoints)} tone="success" size="sm" />
        ) : (
          <bdi dir="ltr" translate="no">
            {pts(row.changePoints)}
          </bdi>
        ),
    },
  }));

  const adherence = view.adherence;
  const adhColumns: AdminTableColumn[] = [
    { key: 'zone', header: t('common.zone') },
    { key: 'planned', header: m('adh.planned'), align: 'end' },
    { key: 'actual', header: m('adh.actual'), align: 'end', hideBelow: 'md' },
    { key: 'share', header: m('adh.share'), align: 'end' },
    { key: 'late', header: m('adh.late'), align: 'end', hideBelow: 'md' },
    { key: 'absent', header: m('adh.absent'), align: 'end', hideBelow: 'md' },
  ];
  const dash = (v: number | null, f: (n: number) => string): string => (v === null ? '—' : f(v));
  const adhRows: AdminTableRow[] = (adherence?.rows ?? []).map((row) => ({
    id: row.zoneId,
    label: row.code,
    cells: {
      zone: (
        <span className={styles.cellStack}>
          <span className={styles.cellMain} translate="no">
            {row.name}
          </span>
          <span className={styles.cellSub} translate="no">
            {row.code}
          </span>
        </span>
      ),
      planned: <span translate="no">{num(row.planned, 1, locale)}</span>,
      actual: <span translate="no">{dash(row.actual, (n) => num(n, 1, locale))}</span>,
      share: <b translate="no">{formatPercent(row.share, locale, 1)}</b>,
      late: <span translate="no">{dash(row.late, (n) => int(n, locale))}</span>,
      absent: <span translate="no">{dash(row.absent, (n) => int(n, locale))}</span>,
    },
  }));

  return (
    <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={description} actions={actions}>
      <div className={styles.stack}>
        <ScopeSwitcher scope={view.scope} cityOptions={view.cityOptions} zoneOptions={view.zoneOptions} cityValue={view.cityValue} zoneValue={view.zoneValue} />

        <div className={styles.headGrid}>
          <Stat label={m('stat.cases')} value={<bdi translate="no">{int(view.stats.cases, locale)}</bdi>} hint={<IllustrativeLabel />} />
          <Stat
            label={m('stat.regAssigned')}
            value={<bdi translate="no">{duration(view.stats.registeredToAssignedSeconds, 'clock')}</bdi>}
            unit={t('common.minShort')}
            hint={<IllustrativeLabel />}
          />
          <Stat label={m('stat.onShift')} value={<bdi translate="no">{int(view.stats.onShift, locale)}</bdi>} hint={<IllustrativeLabel />} />
          <Card padding="md" className={styles.readCard}>
            <div className={styles.readTop}>
              <h2 className={styles.readTitle}>{m('read.title')}</h2>
              <span className={styles.readTags}>
                <IllustrativeLabel />
                {view.stats.targetShare === null ? null : <Badge>{m('read.target', { pct: isolateLtr(formatPercent(view.stats.targetShare, locale)) })}</Badge>}
              </span>
            </div>
            <Reading items={readingItems} compact />
            <p className={styles.readHint}>{m('read.cases', { n: view.stats.fieldCases })}</p>
          </Card>
        </div>

        <div className={styles.chartGrid}>
          <Card padding="lg">
            <div className={styles.cardHeadRow}>
              <h2 className={styles.cardTitle}>{compareTitle}</h2>
              <IllustrativeLabel />
            </div>
            <CompareChart
              label={compareTitle}
              data={view.compareRows.map((row) => ({ label: row.label, values: [row.assignPct, row.registerPct] }))}
              series={[
                { name: m('read.fromAssignment'), color: 'var(--od-chart-1)' },
                { name: m('read.fromRegistration'), color: 'var(--od-chart-6)' },
              ]}
            />
          </Card>
          <Card padding="lg">
            <div className={styles.cardHeadRow}>
              <h2 className={styles.cardTitle}>{m('trend.title')}</h2>
              <IllustrativeLabel />
            </div>
            <TrendChart
              label={m('trend.title')}
              labels={view.trend.labels}
              series={[
                { name: m('read.fromAssignment'), data: view.trend.assignPct, color: 'var(--od-chart-1)' },
                { name: m('read.fromRegistration'), data: view.trend.registerPct, color: 'var(--od-chart-6)' },
              ]}
            />
          </Card>
        </div>

        <div className={styles.chartGrid}>
          <Card padding="lg">
            <div className={styles.cardHeadRow}>
              <h2 className={styles.cardTitle}>{m('fc.title')}</h2>
              <IllustrativeLabel />
            </div>
            <TrendChart
              label={m('fc.title')}
              labels={view.forecast.labels}
              unit="count"
              series={[
                { name: m('fc.cases'), data: view.forecast.cases, color: 'var(--od-chart-1)' },
                ...(view.forecast.forecast === null ? [] : [{ name: m('fc.forecast'), data: view.forecast.forecast, color: 'var(--od-chart-6)', dashed: true }]),
              ]}
            />
          </Card>
          <Card padding="lg">
            <div className={styles.cardHeadRow}>
              <h2 className={styles.cardTitle}>{m('adh.title')}</h2>
              <span className={styles.readTags}>
                <IllustrativeLabel />
                {adherence === null ? null : <Badge>{adherence.actual === null ? m('adh.none') : formatPercent(adherence.share, locale)}</Badge>}
              </span>
            </div>
            {adherence === null ? null : (
              <TrendChart
                label={m('adh.title')}
                labels={adherence.labels}
                unit="count"
                series={[
                  { name: m('adh.plannedOn'), data: adherence.planned, color: 'var(--od-chart-6)', dashed: true },
                  ...(adherence.actual === null ? [] : [{ name: m('adh.actualOn'), data: adherence.actual, color: 'var(--od-chart-1)' }]),
                ]}
              />
            )}
          </Card>
        </div>

        <Card padding="none">
          <div className={styles.tableHeadRow}>
            <h2 className={styles.cardTitle}>{m('zones.title')}</h2>
            <IllustrativeLabel />
          </div>
          <AdminTable columns={zoneColumns} rows={zoneRows} caption={m('zones.title')} pageSize={0} />
        </Card>

        {adherence === null ? null : (
          <Card padding="none">
            <div className={styles.tableHeadRow}>
              <div className={styles.headText}>
                <h2 className={styles.cardTitle}>{m('adh.zones')}</h2>
                <p className={styles.cardSub}>{adherence.dayLabel}</p>
              </div>
              <IllustrativeLabel />
            </div>
            <AdminTable columns={adhColumns} rows={adhRows} caption={m('adh.zones')} pageSize={0} />
          </Card>
        )}

        {view.plan === null ? null : (
          <Card padding="none">
            <div className={styles.tableHeadRow}>
              <div className={styles.headText}>
                <h2 className={styles.cardTitle}>{m('plan.title')}</h2>
                <p className={styles.cardSub}>{m('plan.period', { from: view.plan.fromLabel, to: view.plan.toLabel })}</p>
              </div>
              <span className={styles.readTags}>
                <IllustrativeLabel />
                <Badge>{m('plan.target', { pct: isolateLtr(formatPercent(view.plan.overrideTarget, locale)) })}</Badge>
              </span>
            </div>
            <AdminTable columns={planColumns} rows={planRows} caption={m('plan.title')} pageSize={0} />
          </Card>
        )}

        {view.util === null ? null : (
          <Card padding="none">
            <div className={styles.tableHeadRow}>
              <div className={styles.headText}>
                <h2 className={styles.cardTitle}>{m('util.title')}</h2>
                <p className={styles.cardSub}>{m('plan.period', { from: view.util.fromLabel, to: view.util.toLabel })}</p>
                {view.util.baseFromLabel === null || view.util.baseToLabel === null ? null : (
                  <p className={styles.cardSub}>{m('util.base', { from: view.util.baseFromLabel, to: view.util.baseToLabel })}</p>
                )}
              </div>
              <span className={styles.readTags}>
                <IllustrativeLabel />
                <Badge>{m('util.target', { pts: isolateLtr(num(targetPoints, 0, locale)) })}</Badge>
                {view.util.fromHomeShifts ? <span title={m('util.homeTip')}><Badge>{m('util.home')}</Badge></span> : null}
              </span>
            </div>
            <AdminTable columns={utilColumns} rows={utilRows} caption={m('util.title')} pageSize={0} />
          </Card>
        )}
      </div>
    </ScreenFrame>
  );
}
