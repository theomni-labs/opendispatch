// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Button, Card, Progress, Tooltip } from '@opendispatch/ui';
import { date as formatDate, formatPercent, num, time as formatTime, weekday } from '@opendispatch/ui/format';
import { GitBranch } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { assistantAvailability } from '@/components/opendispatch/assistant/availability';
import { explainScreen } from '@/components/opendispatch/assistant/actions';
import { ExplainCard } from '@/components/opendispatch/assistant/ExplainCard';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip, type StatItem } from '@/components/opendispatch/patterns/StatStrip';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Qualifier } from '@/components/opendispatch/Qualifier';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import { moduleHref } from '@/i18n/module-routes';
import type { ScreenProps } from '@/screens/types';
import { AccuracySkeleton } from './AccuracyCard';
import { AccuracySection } from './AccuracySection';
import { CellsToggle } from './CellsToggle';
import { hourExpectedOf, timeOfDayFactor, type CellsView } from './cells';
import { DemandMap } from './DemandMap';
import styles from './ForecastExplorer.module.css';
import { HeaderActions } from './HeaderActions';
import { PickerBar } from './PickerBar';
import { RulesPanel } from './RulesPanel';
import { TimelineChart } from './TimelineChart';
import { loadCells } from './insight';
import { loadForecastExplorerView } from './view';
import { WhyCard, WhyCardSkeleton } from './WhyCard';

// Forecast Explorer (module 1, flow 1, plan section
// 6.1). Server Component: reads lib/data via
// ModuleRoute's context. City, zone, sub-zone, day,
// time, view, rules live in the URL, each checked
// against an allow-list. ?state= (review hook)
// shows states without reading data.

export async function ForecastExplorerScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.forecast_explorer');
  const a = await getTranslations('opendispatch.assistant');
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} />;
  }

  const query = parseSearchParams(searchParams, {
    city: param.pattern(/^[A-Za-z]{2,4}$/, 4),
    zone: param.id(),
    sub: param.pattern(/^[A-Za-z0-9-]{1,20}$/, 20),
    day: param.pattern(/^\d{4}-\d{2}-\d{2}$/, 10),
    time: param.int(0, 95),
    view: param.enum(['total', 'field', 'remote']),
    rules: param.enum(['active', 'draft']),
    cells: param.flag(),
    past: param.pattern(/^\d{4}-\d{2}-\d{2}$/, 10),
  });
  const [view, assistant] = await Promise.all([loadForecastExplorerView(ctx, query, locale), assistantAvailability(ctx)]);

  if (view.zone.id === '') {
    return <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} isEmpty />;
  }

  if (!view.hasForecast) {
    const href = view.otherDay === null ? null : `?${new URLSearchParams({ city: view.city, zone: view.zone.id, day: view.otherDay }).toString()}`;
    return (
      <ScreenFrame
        def={def}
        access={access}
        homeHref={homeHref}
        sources={view.sources}
        isEmpty
        emptyAction={href === null ? undefined : <Button variant="secondary" href={href}>{m('empty.action')}</Button>}
      />
    );
  }

  const cellsOn = query.cells === true && view.sub !== '';
  const cells: CellsView = cellsOn ? await loadCells(ctx, view.zone.id, view.sub, view.day, view.time, hourExpectedOf(view.timeline.expected, view.time)) : { status: 'off' };
  const subExpected = view.timeline.expected.reduce((sum, v) => sum + v, 0);

  const dayLabel = `${weekday(view.day, { locale, length: 'long', timeZone: 'Asia/Riyadh' })} ${formatDate(view.day, { locale })}`;
  const subtitle = (
    <span>
      {view.zone.fallback === true ? (
        <bdi lang="en" translate="no">
          {view.zone.name}
        </bdi>
      ) : (
        view.zone.name
      )}{' '}
      · <bdi translate="no">{dayLabel}</bdi>
    </span>
  );

  const stats: StatItem[] = [
    { label: m('stat.expected'), value: view.stats.expected, hint: <IllustrativeLabel /> },
    {
      label: m('stat.peak'),
      value: formatTime(view.stats.peakIndex * 15),
      hint: (
        <>
          {m('perInterval')} <IllustrativeLabel />
        </>
      ),
    },
    {
      label: m('stat.range'),
      value: m('range.v', { lo: view.stats.rangeLow, hi: view.stats.rangeHigh }),
      hint: (
        <>
          {view.run === undefined ? null : m('stat.rangeCov', { pct: Math.round(view.run.rangeCoverage * 100) })} <IllustrativeLabel />
        </>
      ),
    },
    {
      label: m('stat.field'),
      value: formatPercent(view.split.fieldShare, locale),
      hint: (
        <>
          <Qualifier /> <IllustrativeLabel />
        </>
      ),
    },
  ];

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      description={subtitle}
      meta={
        view.run === undefined ? null : (
          <Tooltip content={m('run.tip', { date: formatDate(view.run.generatedAt, { locale }) })}>
            <Badge icon={<GitBranch />}>
              <span translate="no">{view.run.version}</span>
            </Badge>
          </Tooltip>
        )
      }
      actions={
        <HeaderActions
          zoneId={view.zone.id}
          modelAdminHref={view.canOpenModelAdmin ? moduleHref({ id: 'admin.forecast_model', console: 'admin' }) : null}
          classificationRulesHref={view.canOpenClassificationRules ? moduleHref({ id: 'admin.classification_rules', console: 'admin' }) : null}
        />
      }
    >
      <div className={styles.stack}>
        <Card padding="md">
          <PickerBar cities={view.cities} zones={view.zones} subZones={view.subZones} city={view.city} zoneId={view.zone.id} sub={view.sub} day={view.day} days={view.days} />
        </Card>

        <StatStrip items={stats} />

        {assistant !== null && assistant.explain.includes('forecast_explorer') ? <ExplainCard action={explainScreen} key={`${view.zone.id}:${view.day}`} target="forecast_explorer" zoneId={view.zone.id} date={view.day} configured={assistant.configured} blockedReason={view.sub !== '' || view.rules === 'draft' ? a('filtersForecast') : undefined} /> : null}

        <div className={styles.detailGrid}>
          <Card padding="none">
            <div className={styles.cardHeader}>
              <h2 className="t-heading-s">{m('map.title')}</h2>
              <div className={styles.headerActions}>
                <CellsToggle on={cellsOn} hasSub={view.sub !== ''} />
                <IllustrativeLabel />
              </div>
            </div>
            <DemandMap zones={view.mapZones} time={view.time} peakIndex={view.stats.peakIndex} label={m('map.title')} cells={cells} locale={locale} />
          </Card>

          <div className={styles.stack}>
            <Card padding="lg">
              <div className={styles.stack}>
                <div className={styles.cardHeaderFlush}>
                  <h2 className="t-heading-s">{m('split.title')}</h2>
                  <IllustrativeLabel />
                </div>
                <RulesPanel split={view.split} rules={view.rules} />
              </div>
            </Card>

            <Card padding="lg">
              <div className={styles.stack}>
                <div className={styles.topHead}>
                  <h2 className="t-heading-s">{m('top.title')}</h2>
                  <span className="t-caption" translate="no">
                    {formatTime(view.time * 15)}
                  </span>
                </div>
                {view.top.map((row) => (
                  <div key={row.code} className={styles.topRow}>
                    <div className={styles.topHead}>
                      <b className="t-body-s" translate="no">
                        {row.code} · {row.name}
                      </b>
                      <span className="t-caption" translate="no">
                        {num(row.value, 2, locale)}
                      </span>
                    </div>
                    <Progress value={row.shareOfMax * 100} size="sm" />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        <Suspense fallback={<WhyCardSkeleton />}>
          <WhyCard
            ctx={ctx}
            zoneId={view.zone.id}
            day={view.day}
            time={view.time}
            locale={locale}
            timeFactor={timeOfDayFactor(view.timeline.expected, view.time)}
            sub={view.sub === '' ? null : { code: view.sub, expected: subExpected }}
          />
        </Suspense>

        <Card padding="lg">
          <div className={styles.stack}>
            <div className={styles.cardHeaderFlush}>
              <h2 className="t-heading-s">{m('tl.title')}</h2>
              <IllustrativeLabel />
            </div>
            <span className="t-caption">{m('tl.unit')}</span>
            <TimelineChart timeline={view.timeline} view={view.view} time={view.time} prayers={view.prayers} fieldShare={view.split.fieldShare} />
            {view.prayers.length > 0 ? (
              <div className={styles.prayers}>
                <b className="t-body-s">{m('prayer.title')}</b>
                {view.prayers.map((p) => (
                  <span key={p.key}>
                    {m(`prayer.${p.key}`)} <bdi dir="ltr" translate="no">{p.time}</bdi>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </Card>

        <Suspense fallback={<AccuracySkeleton />}>
          <AccuracySection ctx={ctx} zoneId={view.zone.id} past={query.past} zones={view.zones} locale={locale} />
        </Suspense>
      </div>
    </ScreenFrame>
  );
}
