// SPDX-License-Identifier: AGPL-3.0-only
import { Alert, Card, Stat } from '@opendispatch/ui';
import { date, formatPercent, time } from '@opendispatch/ui/format';
import { ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AuditTimeline } from '@/components/opendispatch/patterns/AuditTimeline';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import { Link } from '@/i18n/navigation';
import type { ScreenProps } from '@/screens/types';
import { AssumptionsCard } from './AssumptionsCard';
import { BacktestCard } from './BacktestCard';
import { ExperimentsCard } from './ExperimentsCard';
import { ComparisonCard } from './ComparisonCard';
import { loadBacktestCard } from './backtestView';
import { MeasureCard } from './MeasureCard';
import { ModelDialogsProvider, PauseCard, PausedAlert } from './ModelDialogs';
import { ModelHeader } from './ModelHeader';
import { RetrainingCard } from './RetrainingCard';
import { RollingAccuracyCard } from './RollingAccuracyCard';
import { accuracyFigure } from './rollingAccuracy';
import { loadRollingAccuracyCard } from './rollingAccuracyView';
import { RunProvider } from './RunState';
import { RunCard } from './RunCard';
import { VersionsCard } from './VersionsCard';
import styles from './ForecastModel.module.css';
import { historyTitle, MARK, splitData } from './history';
import { loadModelView } from './view';

// Forecast and Model Admin. A Server Component: it reads through lib/data with the request context
// ModuleRoute built and passes plain data to the client files (the versions, the run, the pause and retraining cards, the
// measure). The page holds no search parameter besides the demo-mode review hook `?state=empty|loading|error`, which shows those
// states without reading data. A role with no access never reaches this screen; a view-only role sees every control disabled with
// the reason.
//
// Every figure is Illustrative. "Retrain now" refits and backtests in the background. The 10-minute measure is
// always shown two ways, the primary one from the clock-start setting (default: assignment).

const EXPORT_FILE = 'model-versions.csv';

/**
 * A date and time as a figure. The Stat's value does not wrap, and on a phone (two figures across) "20 Sep 2026, 14:02" is wider than
 * its card, so the text is allowed to break between the date and the time.
 */
function DateTimeValue({ text }: { text: string }) {
  return (
    <bdi translate="no">
      <span className={styles.wrapValue}>{text}</span>
    </bdi>
  );
}

export async function ForecastModelScreen({ def, ctx, access, homeHref, locale: pageLocale, state }: ScreenProps) {
  const m = await getTranslations('admin.forecast_model');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';
  const exportHeader = [m('col.version'), t('common.status'), m('col.trained'), m('col.engine')];
  const description = m('sub');

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <RunProvider>
        <ScreenFrame
          def={def}
          access={access}
          state={state}
          homeHref={homeHref}
          description={description}
          meta={<StubTag kind="demo" />}
          actions={<ModelHeader canEdit={canEdit} paused={false} exportFilename={EXPORT_FILE} exportHeader={exportHeader} exportRows={undefined} />}
        />
      </RunProvider>
    );
  }

  const view = await loadModelView(ctx);
  const backtest = await loadBacktestCard(ctx, locale);
  const accuracy = await loadRollingAccuracyCard(ctx, locale);
  const exportRows = view.versions.map((row) => [row.version, m(`status.${row.status}`), row.trainedAt === null ? '-' : date(row.trainedAt, { locale }), row.engine ?? '-']);
  const titleNode = (text: string) =>
    splitData(text).map((part, i) =>
      part.data ? (
        <bdi key={i} translate="no">
          {part.text}
        </bdi>
      ) : (
        part.text
      ),
    );
  const titled = (view.history?.events ?? []).map((event) => {
    const hit = historyTitle(event.summary_en);
    if (hit === null) return event;
    const v = hit.vars as Record<string, string>;
    const data = (text: string | undefined) => ({ text: text ?? '', data: true });
    const vars: Record<string, { text: string; data: boolean }> =
      hit.key === 'run' || hit.key === 'challengerRun' || hit.key === 'challenger' || hit.key === 'backtest' || hit.key === 'backtestStarted'
        ? { model: data(v.model) }
        : hit.key === 'runCal' || hit.key === 'challengerRunCal'
          ? { model: data(v.model), calendar: { text: m(`cal.${v.calendar ?? 'settings'}`), data: false } }
        : hit.key === 'backtestFailed'
          ? { cls: data(v.cls) }
          : hit.key === 'lift'
          ? { challenger: data(v.challenger), champion: data(v.champion) }
          : hit.key === 'challengerSkipped'
          ? { challenger: data(v.challenger), model: data(v.model) }
          : hit.key === 'degraded'
            ? { n: data(v.n), model: data(v.model) }
            : hit.key === 'optimizer'
            ? { v: data(v.v) }
            : hit.key === 'switched' ? { from: { text: v.from ?? '', data: true }, to: { text: v.to ?? '', data: true } } : hit.key === 'retrain' ? { cad: { text: m(`cad.${v.cad}`), data: false } } : hit.key === 'clock' ? { v: { text: m(v.v === 'assignment' ? 'm.fromAssignment' : 'm.fromRegistration'), data: false } } : hit.key === 'level' ? { v: { text: m(`level.${v.v}`), data: false } } : hit.key === 'gateBaseline' ? { v: { text: m(`bt.base.${v.v === 'naive' ? 'naive' : 'segment'}`), data: false } } : {};
    return { ...event, title: titleNode(m(`h.${hit.key}`, Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, x.data ? `${MARK}${x.text}${MARK}` : x.text])))) };
  });
  const lastRun = view.run?.finishedAt ?? view.run?.startedAt ?? null;
  const rolling = accuracyFigure(accuracy.state);

  return (
    <ModelDialogsProvider>
      <RunProvider>
        <ScreenFrame
          def={def}
          access={access}
          homeHref={homeHref}
          description={view.engineModel === null ? description : titleNode(m('subEngine', { model: `${MARK}${view.engineModel}${MARK}` }))}
          sources={view.sources}
          meta={<StubTag kind="demo" />}
          isEmpty={view.versions.length === 0}
          actions={<ModelHeader canEdit={canEdit} paused={view.pause.paused} exportFilename={EXPORT_FILE} exportHeader={exportHeader} exportRows={exportRows} />}
        >
          <div className={styles.stack}>
            <PausedAlert pause={view.pause} canEdit={canEdit} />
            {rolling?.status === 'above' ? (
              <Alert tone="warning" title={m('accAlert.title')}>
                {m('accAlert.body', { n: rolling.zonesAbove, total: rolling.zones })}
              </Alert>
            ) : null}
            <div className={styles.statGrid}>
              <Stat label={m('stat.active')} value={<bdi translate="no"><span className={styles.wrapValue}>{view.activeVersion ?? '-'}</span></bdi>} />
              <Stat
                label={m('stat.mape', { n: rolling?.days ?? 28 })}
                value={<bdi translate="no">{rolling?.mape == null ? '-' : formatPercent(rolling.mape, locale, 1)}</bdi>}
                hint={
                  rolling === null ? null : (
                    <span className={styles.inline}>
                      {rolling.illustrative ? <IllustrativeLabel /> : null}
                      <span>{m('stat.mapeTarget', { p: formatPercent(rolling.target, locale, 0) })}</span>
                    </span>
                  )
                }
              />
              <Stat label={m('stat.last')} value={lastRun === null ? '-' : <DateTimeValue text={`${date(lastRun, { locale })}, ${time(lastRun)}`} />} />
              <Stat label={m('stat.next')} value={view.nextRetraining === null ? '-' : <DateTimeValue text={`${date(view.nextRetraining.date, { locale })}, ${view.nextRetraining.time}`} />} />
            </div>
            <div className={styles.grid2}>
              <div className={styles.col}>
                <VersionsCard versions={view.versions} activeVersion={view.activeVersion} engineModel={view.engineModel} canEdit={canEdit} />
                {backtest.state === null && !backtest.error ? null : <BacktestCard data={backtest} canEdit={canEdit} mapeTarget={rolling?.target ?? null} />}
                <RollingAccuracyCard data={accuracy} />
                {view.experiments === null ? null : <ExperimentsCard rows={view.experiments} />}
                <RunCard run={view.run} paused={view.pause.paused} canEdit={canEdit} />
                {view.assumptions === null ? null : <AssumptionsCard assumptions={view.assumptions} />}
                {view.history === null ? null : (
                  <Card padding="lg">
                    <div className={styles.cardInner}>
                      <div className={styles.head}>
                        <h2 className={styles.cardTitle}>{m('h.title')}</h2>
                        <Link href="/admin/audit-log" className={styles.link}>
                          {m('h.audit')}
                          <ChevronRight aria-hidden="true" className={styles.flip} />
                        </Link>
                      </div>
                      <AuditTimeline events={titled} names={view.history.names} />
                    </div>
                  </Card>
                )}
              </div>
              <aside className={styles.col}>
                <PauseCard pause={view.pause} canEdit={canEdit} horizonDays={view.comparison?.horizonDays ?? null} />
                <RetrainingCard schedule={view.schedule} canEdit={canEdit} autoRetrain={view.comparison?.autoRetrain ?? null} />
                {view.comparison === null ? null : <ComparisonCard comparison={view.comparison} canEdit={canEdit} />}
                <MeasureCard clockStart={view.clockStart} planningLevel={view.planningLevel} optimizerModel={view.optimizerModel} remoteHandling={view.remoteHandling} reading={view.reading} canEdit={canEdit} />
              </aside>
            </div>
          </div>
        </ScreenFrame>
      </RunProvider>
    </ModelDialogsProvider>
  );
}
