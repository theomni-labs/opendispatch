// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Card, StatusPill, Tag, Tooltip } from '@opendispatch/ui';
import { date as formatDate, duration, formatPercent, time as formatTime } from '@opendispatch/ui/format';
import { Lock, Timer } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Reading, type ReadingItem } from '@/components/opendispatch/Reading';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { SimulationRun } from '@/lib/types';
import type { ScreenProps } from '@/screens/types';
import { HeaderActions, RunButton } from './HeaderActions';
import { IntervalsChart } from './IntervalsChart';
import { ReplayInputsCard } from './ReplayInputsCard';
import { readingOrder, sharesInOrder } from './readings';
import styles from './ServiceLevelSimulator.module.css';
import { ASSIGNMENT_POLICIES, SIMULATOR_TABS } from './types';
import { loadServiceLevelSimulatorView, type RunRef, type ZoneRow } from './view';
import { isolateLtr } from '@/components/opendispatch/isolateLtr';

// Service-Level Simulator (module 7

const STATUS_TONE: Readonly<Record<SimulationRun['status'], 'neutral' | 'success' | 'danger'>> = {
  queued: 'neutral',
  running: 'neutral',
  succeeded: 'success',
  failed: 'danger',
};

export async function ServiceLevelSimulatorScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.service_level_simulator');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  const neutralActions = <HeaderActions canEdit={canEdit} hasInputs={false} rosterId="" runDate="" policy="nearest" />;
  if (state !== undefined) {
    const emptyRun = <RunButton canEdit={canEdit} hasInputs={false} rosterId="" runDate="" policy="nearest" variant="secondary" />;
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={neutralActions} emptyAction={emptyRun} />;
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(SIMULATOR_TABS),
    run: param.id(),
    ref: param.id(),
    date: param.pattern(/^\d{4}-\d{2}-\d{2}$/, 10),
    policy: param.enum(ASSIGNMENT_POLICIES),
    izone: param.pattern(/^[A-Za-z0-9-]{1,20}$/, 20),
  });
  const tab = query.tab ?? 'zones';
  const view = await loadServiceLevelSimulatorView(ctx, query, locale);
  const hasInputs = view.rosterOptions.length > 0 && view.dateOptions.length > 0;
  const actions = <HeaderActions canEdit={canEdit} hasInputs={hasInputs} rosterId={view.form.rosterId} runDate={view.form.runDate} policy={view.form.policy} />;

  if (view.isEmpty) {
    const emptyRun = <RunButton canEdit={canEdit} hasInputs={hasInputs} rosterId={view.form.rosterId} runDate={view.form.runDate} policy={view.form.policy} variant="secondary" />;
    return <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={m('sub')} actions={actions} isEmpty emptyAction={emptyRun} />;
  }

  const refText = (ref: RunRef, short: boolean): string => {
    if (ref.kind === 'roster' && ref.zoneCode !== undefined && ref.date !== undefined) return m('ref.roster', { zone: ref.zoneCode, date: formatDate(ref.date, { locale }) });
    if (ref.kind === 'scenario') return short ? m('ref.scenarioShort') : m('ref.scenario', { name: ref.name ?? '' });
    return m('ref.all');
  };

  const primaryIsAssignment = view.clockStart === 'assignment';
  const overall = view.overall;

  const readingItems: ReadingItem[] | null =
    overall === null
      ? null
      : (['fromAssignment', 'fromRegistration'] as const)
          .map((key) => {
            const reading = key === 'fromAssignment' ? overall.fromAssignment : overall.fromRegistration;
            const primary = (key === 'fromAssignment') === primaryIsAssignment;
            const note = `${primary ? `${t('opendispatch.reading.primary')} · ` : ''}${m('read.of', { n: reading.within_count, total: overall.fieldCaseCount })}`;
            return { label: m(`read.${key}`), value: <bdi dir="ltr">{formatPercent(reading.share, locale)}</bdi>, note, primary, illustrative: view.illustrative };
          })
          .sort((a, b) => Number(b.primary) - Number(a.primary));

  const zoneColumns: AdminTableColumn[] = [
    { key: 'zone', header: t('common.zone') },
    { key: 'cases', header: m('col.cases'), align: 'end', hideBelow: 'md' },
    { key: 'field', header: m('col.field'), align: 'end', hideBelow: 'md' },
    { key: 'primary', header: m(`read.${primaryIsAssignment ? 'fromAssignment' : 'fromRegistration'}`), align: 'end' },
    { key: 'secondary', header: m(`read.${primaryIsAssignment ? 'fromRegistration' : 'fromAssignment'}`), align: 'end' },
    { key: 'median', header: m('col.median'), align: 'end' },
    { key: 'p90', header: m('col.p90'), align: 'end', hideBelow: 'md' },
  ];

  const zoneRow = (row: ZoneRow): AdminTableRow => {
    const primary = primaryIsAssignment ? row.fromAssignment : row.fromRegistration;
    const secondary = primaryIsAssignment ? row.fromRegistration : row.fromAssignment;
    return {
      id: row.zoneId,
      label: row.zoneCode,
      cells: {
        zone: (
          <Tag color="gray">
            <span translate="no">{row.zoneCode}</span>
          </Tag>
        ),
        cases: <span translate="no">{row.caseCount}</span>,
        field: <span translate="no">{row.fieldCount}</span>,
        primary: <b translate="no">{formatPercent(primary.share, locale)}</b>,
        secondary: <span translate="no">{formatPercent(secondary.share, locale)}</span>,
        median: <span translate="no">{duration(row.medianSeconds, 'clock')}</span>,
        p90: <span translate="no">{duration(row.p90Seconds, 'clock')}</span>,
      },
    };
  };

  const zoneRows = view.zones.map(zoneRow);
  if (view.showTotal && overall !== null) {
    const totalPrimary = primaryIsAssignment ? overall.fromAssignment : overall.fromRegistration;
    const totalSecondary = primaryIsAssignment ? overall.fromRegistration : overall.fromAssignment;
    zoneRows.push({
      id: '__total__',
      label: m('total'),
      cells: {
        zone: <b>{m('total')}</b>,
        cases: <b translate="no">{view.zones.reduce((sum, z) => sum + z.caseCount, 0)}</b>,
        field: <b translate="no">{overall.fieldCaseCount}</b>,
        primary: <b translate="no">{formatPercent(totalPrimary.share, locale)}</b>,
        secondary: <b translate="no">{formatPercent(totalSecondary.share, locale)}</b>,
        median: <b translate="no">{duration(overall.medianSeconds, 'clock')}</b>,
        p90: <b translate="no">{duration(overall.p90Seconds, 'clock')}</b>,
      },
    });
  }

  const historyColumns: AdminTableColumn[] = [
    { key: 'run', header: m('col.run') },
    { key: 'roster', header: m('col.roster') },
    { key: 'policy', header: m('col.policy'), hideBelow: 'md' },
    { key: 'day', header: m('f.date'), hideBelow: 'md' },
    { key: 'primary', header: m(`read.${readingOrder(primaryIsAssignment)[0]}`), align: 'end' },
    { key: 'secondary', header: m(`read.${readingOrder(primaryIsAssignment)[1]}`), align: 'end', hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
  ];

  const historyRows: AdminTableRow[] = view.history.map((row) => {
    const [primary, secondary] = sharesInOrder(primaryIsAssignment, row.fromAssignmentShare, row.fromRegistrationShare);
    return {
      id: row.id,
      tone: row.selected ? 'info' : undefined,
      cells: {
        run: (
          <span>
            <span className={styles.cellMain} translate="no">
              {formatDate(row.createdAtIso, { locale })}
            </span>
            <span className={styles.cellSub} translate="no">
              {formatTime(row.createdAtIso)}
            </span>
          </span>
        ),
        roster: <span className={styles.wrapCell}>{refText(row.ref, true)}</span>,
        policy: <span>{m(`policy.${row.policy}`)}</span>,
        day: <span translate="no">{formatDate(row.runDate, { locale })}</span>,
        primary: <b translate="no">{formatPercent(primary, locale)}</b>,
        secondary: <span translate="no">{formatPercent(secondary, locale)}</span>,
        status: <StatusPill status={m(`status.${row.status}`)} tone={STATUS_TONE[row.status]} size="sm" />,
      },
    };
  });

  const runMeta = view.runMeta;
  const meta = runMeta === null ? '' : `${refText(runMeta.ref, false)} · ${m(`policy.${runMeta.policy}`)} · ${formatDate(runMeta.runDate, { locale })}`;
  const engineLine =
    runMeta?.engine == null ? null : (
      <>
        {' · '}
        <bdi dir="ltr">{runMeta.engine.model}</bdi>
        {` · ${m('engine')} `}
        <bdi dir="ltr">{runMeta.engine.version}</bdi>
      </>
    );

  const tabs = (
    <UrlTabs
      id="sl"
      ariaLabel={m('tabs.label')}
      defaultTab="zones"
      tabs={[
        { value: 'zones', label: m('tab.zones') },
        { value: 'intervals', label: m('tab.intervals') },
        { value: 'history', label: m('tab.history'), count: view.historyCount },
      ]}
    />
  );

  return (
    <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={m('sub')} actions={actions}>
      <div className={styles.stack}>
        <Card padding="lg">
          <div className={styles.stack}>
            <div className={styles.headRow}>
              <h2 className="t-heading-s">{m('in.title')}</h2>
              <div className={styles.badges}>
                <Tooltip content={m('setting.tip')}>
                  <Badge icon={<Lock />}>{m(`setting.primary.${view.clockStart}`)}</Badge>
                </Tooltip>
                <Tooltip content={m('setting.tip')}>
                  <Badge icon={<Timer />}>{m('setting.target', { min: Math.round((view.runMeta?.thresholdSeconds ?? 600) / 60) })}</Badge>
                </Tooltip>
              </div>
            </div>
            <ReplayInputsCard rosterOptions={view.rosterOptions} dateOptions={view.dateOptions} rosterId={view.form.rosterId} runDate={view.form.runDate} policy={view.form.policy} />
          </div>
        </Card>

        <Card padding="none">
          <div className={`${styles.headRow} ${styles.resultsHead}`}>
            <div className={styles.cardTitleRow}>
              <h2 className="t-heading-s">{m('res.title')}</h2>
              <IllustrativeLabel />
              {view.targetShare === null ? null : (
                <Tooltip content={m('setting.tip')}>
                  <Badge>{m('res.target', { pct: isolateLtr(formatPercent(view.targetShare, locale)) })}</Badge>
                </Tooltip>
              )}
            </div>
            <span className={styles.meta} translate="no">
              {meta}
              {engineLine}
            </span>
          </div>
          <div className={styles.resultsBody}>
            <div className={styles.stack}>
              {readingItems === null ? <p className="t-body-s">{m('outputPending')}</p> : <Reading items={readingItems} />}
              {tabs}
              <TabPanel id="sl" value={tab}>
                {tab === 'zones' ? (
                  <AdminTable columns={zoneColumns} rows={zoneRows} caption={m('tab.zones')} rowParam={false} pageSize={0} />
                ) : tab === 'intervals' ? (
                  <IntervalsChart zoneOptions={view.intervalZoneOptions} zone={view.intervalZone} points={view.intervals} clockStart={view.clockStart} />
                ) : (
                  <AdminTable columns={historyColumns} rows={historyRows} caption={m('tab.history')} rowParam="run" pageSize={0} />
                )}
              </TabPanel>
            </div>
          </div>
          <div className={`${styles.footNote} ${styles.resultsFoot}`}>
            <span>{m('foot')}</span>
            <span>{m('footPolicy')}</span>
          </div>
        </Card>
      </div>
    </ScreenFrame>
  );
}
