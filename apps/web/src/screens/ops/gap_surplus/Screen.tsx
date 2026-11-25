// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Button, Card } from '@opendispatch/ui';
import { formatPercent } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import { isolateLtr } from '@/components/opendispatch/isolateLtr';
import { assistantAvailability } from '@/components/opendispatch/assistant/availability';
import { explainScreen } from '@/components/opendispatch/assistant/actions';
import { ExplainCard } from '@/components/opendispatch/assistant/ExplainCard';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip, type StatItem } from '@/components/opendispatch/patterns/StatStrip';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { CauseFilter } from './CauseFilter';
import { CellDrawer } from './CellDrawer';
import { DensityToggle } from './DensityToggle';
import styles from './GapSurplus.module.css';
import { GapGrid } from './GapGrid';
import { HeaderActions } from './HeaderActions';
import { SHOW_VALUES } from './kpi';
import { ShowToggle } from './ShowToggle';
import { CAUSE_VALUES, DENSITY_VALUES } from './types';
import { loadGapSurplusView } from './view';

// Gap and Surplus (Ops 6)

export async function GapSurplusScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.gap_surplus');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<HeaderActions fieldPlannerHref={null} standbyHref={null} />} />;
  }

  const query = parseSearchParams(searchParams, {
    city: param.pattern(/^[A-Za-z0-9-]{1,8}$/, 8),
    zone: param.id(),
    cause: param.enum(CAUSE_VALUES),
    dens: param.enum(DENSITY_VALUES),
    show: param.enum(SHOW_VALUES),
    q: param.text(80),
    cell: param.pattern(/^[0-9a-f-]{36}:\d{1,2}$/, 40),
    date: param.pattern(/^\d{4}-\d{2}-\d{2}$/, 10),
  });

  const [view, assistant] = await Promise.all([loadGapSurplusView(ctx, query, locale), assistantAvailability(ctx)]);
  const actions = <HeaderActions fieldPlannerHref={view.canOpenFieldPlanner ? view.fieldPlannerHref : null} standbyHref={view.canOpenStandby ? view.standbyHref : null} />;
  const description = (
    <span translate="no">{view.dateLabel}</span>
  );

  if (view.isEmpty) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        homeHref={homeHref}
        sources={view.sources}
        description={description}
        actions={actions}
        isEmpty
        emptyAction={view.emptyActionHref === null ? undefined : <Button href={view.emptyActionHref}>{t('nav.ops.field_planner.menu')}</Button>}
      />
    );
  }

  // Explain sees the zone and day, not other filters
  const explainZone = view.zoneOptions.some((o) => o.value === query.zone) ? query.zone : undefined;
  const explainBlocked = query.city !== undefined || query.cause !== undefined || (query.q ?? '').trim() !== '';
  const worst = view.stats.worst;
  const stats: StatItem[] = [
    {
      label: m('stat.met'),
      value: view.stats.met === null ? '—' : isolateLtr(formatPercent(view.stats.met, locale)),
      hint: (
        <>
          <span data-gap-intervals={view.stats.gaps}>{m('stat.counts', { gaps: view.stats.gaps, surplus: view.stats.surplus })}</span> <IllustrativeLabel />
        </>
      ),
    },
    {
      label: m('stat.reach'),
      value: view.stats.outOfReach === null ? '—' : isolateLtr(formatPercent(view.stats.outOfReach, locale)),
      hint: (
        <>
          <span>{m('stat.reachHint')}</span> <IllustrativeLabel />
        </>
      ),
    },
    {
      label: m('stat.worst'),
      value: worst === null ? 0 : worst.value,
      hint:
        worst === null ? (
          <IllustrativeLabel />
        ) : (
          <>
            <span translate="no">
              {worst.zoneCode} {worst.timeLabel}
            </span>{' '}
            <IllustrativeLabel />
          </>
        ),
    },
    {
      label: m('stat.cause'),
      value: view.stats.mainCause === null ? '—' : m(`cause.${view.stats.mainCause}`),
      hint: <IllustrativeLabel />,
    },
  ];

  return (
    <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={description} actions={actions}>
      <div className={styles.stack}>
        <StatStrip items={stats} />

        {assistant !== null && assistant.explain.includes('gap_surplus') ? (
          <ExplainCard action={explainScreen} key={`${explainZone ?? ''}:${view.rosterDate ?? ''}`} target="gap_surplus" zoneId={explainZone} date={view.rosterDate} configured={assistant.configured} blockedReason={explainBlocked ? t('opendispatch.assistant.filtersGap') : undefined} />
        ) : null}

        <Card padding="none">
          <ListToolbar
            searchLabel={m('search')}
            filters={[
              { key: 'city', label: m('city'), options: view.cityOptions },
              { key: 'zone', label: t('common.zone'), options: view.zoneOptions },
            ]}
            actions={
              <div className={styles.toggles}>
                <ShowToggle value={view.grid.show} />
                <DensityToggle value={view.density} />
              </div>
            }
          />
          <div className={styles.cardBody}>
            <div className={styles.cardHeadRow}>
              <div className={styles.cardTitleRow}>
                <h2 className={styles.cardTitle}>{m('grid.title')}</h2>
                <IllustrativeLabel />
              </div>
              <CauseFilter value={view.cause} counts={view.causeCounts} />
            </div>
            <GapGrid grid={view.grid} label={m('grid.title')} />
            {view.basis === null ? null : (
              <div className={styles.legend}>
                <span className={styles.key}>
                  {view.basis.method === 'rate_convention' ? (
                    m('basis.customer')
                  ) : (
                    <>
                      {view.basis.minutesFrom === view.basis.minutesTo
                        ? m('basis.duration', { min: view.basis.minutesFrom ?? 0 })
                        : m('basis.durationRange', { from: view.basis.minutesFrom ?? 0, to: view.basis.minutesTo ?? 0 })}
                      <IllustrativeLabel />
                    </>
                  )}
                </span>
                <span className={styles.key}>
                  {m('basis.sick', { n: view.basis.sickDays })}
                  <Badge tone="neutral" size="sm">
                    {m('basis.assumption')}
                  </Badge>
                </span>
              </div>
            )}
          </div>
        </Card>
      </div>

      <CellDrawer target={view.drawer} />
    </ScreenFrame>
  );
}
