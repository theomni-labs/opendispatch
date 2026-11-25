// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Button, Card, StatusPill } from '@opendispatch/ui';
import { date as formatDate, formatPercent, weekday } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip, type StatItem } from '@/components/opendispatch/patterns/StatStrip';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { cx } from '@/components/opendispatch/cx';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import { moduleHref } from '@/i18n/module-routes';
import type { ScreenProps } from '@/screens/types';
import { CoverageMap } from './CoverageMap';
import { HeaderActions } from './HeaderActions';
import { PickerBar } from './PickerBar';
import { PointsList } from './PointsList';
import { RecommendedMove } from './RecommendedMove';
import styles from './StandbyCoverage.module.css';
import { loadStandbyCoverageView, outOfReach } from './view';
import { isolateLtr } from '@/components/opendispatch/isolateLtr';

// Standby and Coverage Map (module 5)

export async function StandbyCoverageScreen({ def, ctx, access, homeHref, locale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.standby_coverage');
  const t = await getTranslations();
  const canEdit = access.access === 'edit';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<HeaderActions locationsHref={null} />} />;
  }

  const query = parseSearchParams(searchParams, {
    zone: param.id(),
    date: param.pattern(/^\d{4}-\d{2}-\d{2}$/, 10),
    pt: param.id(),
  });
  const view = await loadStandbyCoverageView(ctx, { zone: query.zone, date: query.date });
  const locationsHref = view.canOpenLocations ? moduleHref({ id: 'admin.locations', console: 'admin' }) : null;

  if (view.zone.id === '') {
    return <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} actions={<HeaderActions locationsHref={locationsHref} />} isEmpty />;
  }

  const dateLabel = `${weekday(view.date, { locale, length: 'long', timeZone: 'Asia/Riyadh' })} ${formatDate(view.date, { locale })}`;
  const subtitle = (
    <span translate="no">
      {view.zone.name} · {dateLabel}
    </span>
  );
  const actions = <HeaderActions locationsHref={locationsHref} />;

  if (view.points.length === 0) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        homeHref={homeHref}
        sources={view.sources}
        description={subtitle}
        actions={actions}
        isEmpty
        emptyAction={locationsHref === null ? undefined : <Button href={locationsHref}>{t('nav.admin.locations.menu')}</Button>}
      />
    );
  }

  const stats: StatItem[] = [
    { label: m('stat.points'), value: view.stats.points },
    { label: m('stat.waiting'), value: view.stats.waiting, hint: <IllustrativeLabel /> },
    { label: m('stat.covered'), value: m('stat.coverageValue', { covered: view.stats.coveredCount, total: view.stats.subZoneCount }) },
    {
      label: m('stat.out'),
      value: view.stats.reachShare === null ? '—' : isolateLtr(formatPercent(outOfReach(view.stats.reachShare), locale)),
      hint: (
        <span className={styles.hintRow}>
          <span>{m('stat.outHint', { n: view.stats.uncoveredCount })}</span>
          <IllustrativeLabel />
        </span>
      ),
    },
  ];

  const selectedPointId = query.pt !== undefined && view.points.some((p) => p.id === query.pt) ? query.pt : null;

  return (
    <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={subtitle} actions={actions}>
      <div className={styles.stack}>
        <StatStrip items={stats} />

        <div className={styles.detailGrid}>
          <Card padding="none">
            <div className={styles.cardHeader}>
              <h2 className="t-heading-s">{m('map.title')}</h2>
              <div className={styles.cardHeaderActions}>
                <IllustrativeLabel />
                <PickerBar zoneOptions={view.zoneOptions} zoneId={view.zone.id} />
              </div>
            </div>
            <div className={styles.mapBody}>
              <CoverageMap zone={view.zone} points={view.points} subZones={view.subZones} selectedPointId={selectedPointId} label={m('map.title')} />
              <div className={styles.legend}>
                <span className={styles.key}>
                  <i className={cx(styles.swatch, styles.swatchPin)} aria-hidden="true" />
                  <span>{m('key.point')}</span>
                </span>
                <span className={styles.key}>
                  <i className={cx(styles.swatch, styles.swatchCover)} aria-hidden="true" />
                  <span>{m('key.cover')}</span>
                </span>
                <span className={styles.key}>
                  <i className={cx(styles.swatch, styles.swatchOk)} aria-hidden="true" />
                  <span>{m('key.ok')}</span>
                </span>
                <span className={styles.key}>
                  <i className={cx(styles.swatch, styles.swatchGap)} aria-hidden="true" />
                  <span>{m('key.out')}</span>
                </span>
              </div>
            </div>
          </Card>

          <aside className={styles.aside}>
            <Card padding="none">
              <div className={styles.cardHeader}>
                <h2 className="t-heading-s">{m('list.title')}</h2>
              </div>
              <PointsList points={view.points} selectedId={selectedPointId} limitKm={view.limitKm} />
              <div className={styles.uncoveredRow}>
                {view.uncovered.length === 0 ? (
                  <StatusPill status={m('unc.none')} tone="success" size="sm" />
                ) : (
                  <>
                    <span className="t-caption">{m('unc.label')}</span>
                    {view.uncovered.map((sub) => (
                      <Badge key={sub.id} tone="danger" dot size="sm">
                        <span translate="no">
                          {sub.code.slice(-2)} · {sub.name}
                        </span>
                      </Badge>
                    ))}
                  </>
                )}
              </div>
            </Card>

            <Card padding="lg">
              <div className={styles.recoHead}>
                <h2 className="t-heading-s">{m('reco.title')}</h2>
                <IllustrativeLabel />
              </div>
              <RecommendedMove zoneId={view.zone.id} date={view.date} move={view.move} uncoveredCount={view.stats.uncoveredCount} canEdit={canEdit} locationsHref={locationsHref} />
            </Card>
          </aside>
        </div>
      </div>
    </ScreenFrame>
  );
}
