// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Button, Card, Inline, StatusPill } from '@opendispatch/ui';
import { ChevronRight, Coffee } from 'lucide-react';
import mirror from '@/components/opendispatch/mirror.module.css';
import { date as formatDate } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import type { AdminTableColumn, AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { AdminTable } from '@/components/opendispatch/patterns/AdminTable';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip, type StatItem } from '@/components/opendispatch/patterns/StatStrip';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { RosterGrid } from '@/components/opendispatch/RosterGrid';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { ApprovalActions } from './ApprovalActions';
import { BuildRosterButton } from './BuildRosterButton';
import styles from './FieldPlanner.module.css';
import { MoreMenu } from './MoreMenu';
import { OverrideDrawer } from './OverrideDrawer';
import { OverridesTable } from './OverridesTable';
import { PickerBar } from './PickerBar';
import { modelFamilyKey, sourceChipOf } from './source';
import { loadFieldPlannerView, loadFieldPlannerWeekView } from './view';
import { WeekActions } from './WeekActions';
import { WEEK_TABS, WeekView } from './WeekView';
import { gapHref } from './links';

// Field Planner Workbench

const TABS = ['roster', 'overrides', 'vehicles'] as const;
const STATUS_TONE: Readonly<Record<string, 'neutral' | 'warning' | 'success'>> = {
  building: 'neutral',
  draft: 'neutral',
  submitted: 'warning',
  approved: 'success',
  rejected: 'neutral',
  published: 'success',
  superseded: 'neutral',
};

export async function FieldPlannerScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.field_planner');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} />;
  }

  const query = parseSearchParams(searchParams, {
    zone: param.id(),
    date: param.pattern(/^\d{4}-\d{2}-\d{2}$/, 10),
    tab: param.enum([...TABS, ...WEEK_TABS]),
    view: param.enum(['day', 'week'] as const),
  });

  if (query.view === 'week') {
    const week = await loadFieldPlannerWeekView(ctx, { date: query.date }, locale);
    const gate = (allowed: boolean, why: string): string | null => (!canEdit ? t('opendispatch.gate.viewOnly') : allowed ? null : m(why));
    return (
      <ScreenFrame
        def={def}
        access={access}
        homeHref={homeHref}
        sources={week.sources}
        isEmpty={week.zones.length === 0}
        actions={<WeekActions weekStart={week.weekStart} buildReason={gate(week.canBuild, 'week.r.none')} submitReason={gate(week.canSubmit, 'week.r.noDraft')} publishReason={gate(week.canPublish, 'week.r.noApproved')} />}
      >
        <div className={styles.stack}>
          <PickerBar view="week" zoneOptions={[]} zoneId="" date={week.weekStart} weekEnd={week.days[6]} prevDate={week.prevWeek} nextDate={week.nextWeek} />
          <WeekView week={week} tab={query.tab === 'availability' ? 'availability' : 'schedule'} locale={locale} />
        </div>
      </ScreenFrame>
    );
  }

  const view = await loadFieldPlannerView(ctx, { zone: query.zone, date: query.date }, locale);
  const dayTab = (TABS as readonly string[]).includes(query.tab ?? '') ? (query.tab as (typeof TABS)[number]) : undefined;
  const tab = view.roster === undefined ? 'roster' : (dayTab ?? 'roster');
  const dateLabel = formatDate(view.date, { locale });
  const subtitle = view.zone.name === '' ? undefined : (
    <span translate="no">
      <bdi>{view.zone.name}</bdi> · <bdi>{dateLabel}</bdi>
    </span>
  );

  const overrideDrawer =
    view.roster === undefined
      ? null
      : (
          <OverrideDrawer
            rosterId={view.roster.id}
            zoneLabel={view.zone.name}
            date={dateLabel}
            options={view.roster.drawer}
            disabledReason={!canEdit ? t('opendispatch.gate.viewOnly') : view.roster.status === 'published' || view.roster.status === 'superseded' ? m('r.notOverridable') : null}
          />
        );

  const actions = (
    <>
      {overrideDrawer}
      {view.roster !== undefined ? (
        <MoreMenu rosterId={view.roster.id} canSubmit={canEdit && view.roster.approval.canSubmit} submitReason={!canEdit ? t('opendispatch.gate.viewOnly') : view.roster.approval.submitReason === null ? null : m(`r.${view.roster.approval.submitReason}`)} />
      ) : null}
    </>
  );

  if (view.roster === undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        homeHref={homeHref}
        sources={view.sources}
        isEmpty
        emptyAction={
          view.zone.id === '' ? undefined : (
            <BuildRosterButton zoneId={view.zone.id} date={view.date} disabledReason={canEdit ? null : t('opendispatch.gate.viewOnly')} />
          )
        }
        description={subtitle}
      >
        {view.zone.id === '' ? null : <PickerBar view="day" zoneOptions={view.zoneOptions} zoneId={view.zone.id} date={view.date} prevDate={view.prevDate} nextDate={view.nextDate} />}
      </ScreenFrame>
    );
  }

  const roster = view.roster;
  const approval = roster.approval;
  const line1 =
    approval.submittedByName === null || approval.submittedDate === null
      ? m('by.draft')
      : m('by.submitted', { name: approval.submittedByIsMe ? m('you') : approval.submittedByName, date: formatDate(approval.submittedDate, { locale }) });
  const line2 =
    approval.status === 'approved' && approval.approvedByName !== null && approval.approvedDate !== null
      ? m('by.approved', { name: approval.approvedByIsMe ? m('you') : approval.approvedByName, date: formatDate(approval.approvedDate, { locale }) })
      : approval.status === 'published' && approval.publishedDate !== null
        ? m('by.published', { date: formatDate(approval.publishedDate, { locale }) })
        : m('by.none');

  const sourceChip = roster.source === null ? null : sourceChipOf(roster.source, (key) => m(key));
  const gridRows = roster.gridRows.map((row) => (row.id === 'gap-row' ? { ...row, name: m('gap.label'), sub: m('gap.count', { n: String(roster.stats.gapIntervals) }) } : row));

  const stats: StatItem[] = [
    { label: m('stat.agents'), value: roster.stats.agents },
    {
      label: m('stat.gaps'),
      value: roster.stats.gapIntervals,
      hint: (
        <Inline gap={8} align="center" wrap>
          <IllustrativeLabel />
          <Button variant="link" size="sm" href={gapHref(view.zone.id, view.date)} endIcon={<ChevronRight className={mirror.mirror} />}>
            {t('nav.ops.gap_surplus.menu')}
          </Button>
        </Inline>
      ),
    },
    { label: m('stat.surplus'), value: roster.stats.surplusIntervals, hint: <IllustrativeLabel /> },
    { label: m('stat.overrides'), value: roster.stats.pendingOverrides },
  ];

  const tabs = (
    <UrlTabs
      id="fp"
      ariaLabel={m('tab.roster')}
      defaultTab="roster"
      resetParams={[]}
      tabs={[
        { value: 'roster', label: m('tab.roster') },
        { value: 'overrides', label: m('tab.overrides'), count: roster.overrides.length },
        { value: 'vehicles', label: m('tab.vehicles') },
      ]}
    />
  );

  const vehicleColumns: AdminTableColumn[] = [
    { key: 'vehicle', header: t('common.vehicle') },
    ...roster.shiftColumns.map((column): AdminTableColumn => ({ key: column.id, header: column.name })),
  ];
  const vehicleRows: AdminTableRow[] = roster.vehicleRows.map((vehicle) => ({
    id: vehicle.id,
    label: vehicle.plate,
    cells: {
      vehicle: <span translate="no">{vehicle.plate}</span>,
      ...Object.fromEntries(
        roster.shiftColumns.map((column) => [
          column.id,
          vehicle.byShift[column.id] === null || vehicle.byShift[column.id] === undefined ? (
            <span className="t-caption">{m('vehTable.unassigned')}</span>
          ) : (
            <span translate="no">{vehicle.byShift[column.id]}</span>
          ),
        ]),
      ),
    },
  }));

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      description={subtitle}
      meta={<StatusPill status={m(`status.${approval.status}`)} tone={STATUS_TONE[approval.status] ?? 'neutral'} />}
      actions={actions}
    >
      <div className={styles.stack}>
        <PickerBar view="day" zoneOptions={view.zoneOptions} zoneId={view.zone.id} date={view.date} prevDate={view.prevDate} nextDate={view.nextDate} />

        <Card padding="md">
          <Inline justify="between" wrap gap={16} align="center">
            <div className={styles.approvalText}>
              <b translate={approval.submittedByIsMe ? undefined : 'no'} className="t-body-m">
                {line1}
              </b>
              <span className="t-caption">{line2}</span>
            </div>
            <ApprovalActions rosterId={roster.id} approval={approval} canEdit={canEdit} />
          </Inline>
        </Card>

        <StatStrip items={stats} />

        {tabs}

        <TabPanel id="fp" value={tab}>
          {tab === 'roster' ? (
            <Card padding="none">
              <div className={styles.gridHeader}>
                <h2 className="t-heading-s">{m('grid.title')}</h2>
                <Inline wrap gap={8} align="center">
                  {sourceChip === null ? null : <StatusPill status={sourceChip.label} tone={sourceChip.tone} />}
                  {sourceChip?.note == null ? null : <span className="t-caption">{sourceChip.note}</span>}
                  {roster.optimizerModel === null && roster.engineVersion === null ? null : (
                    <span className="t-caption" data-testid="fp-model">
                      {roster.optimizerModel === null ? null : (
                        <>
                          {`${m(modelFamilyKey(roster.optimizerModel))} `}
                          <bdi dir="ltr" translate="no">
                            {roster.optimizerModel}
                          </bdi>
                          {' · '}
                        </>
                      )}
                      {roster.solverStatus === null ? null : `${m(`solver.${roster.solverStatus}`)} · `}
                      {roster.engineVersion === null ? null : (
                        <>
                          {`${m('engine')} `}
                          <bdi dir="ltr" translate="no">
                            {roster.engineVersion}
                          </bdi>
                        </>
                      )}
                    </span>
                  )}
                  <IllustrativeLabel />
                </Inline>
              </div>
              <RosterGrid
                rows={gridRows}
                headLabel={t('common.agent')}
                startHour={6}
                endHour={30}
                stepMin={15}
                legendExtra={
                  <Badge tone="info" size="sm" icon={<Coffee />}>
                    <span data-testid="fp-policy">{m(`policy.${view.prayerPolicy}`)}</span>
                  </Badge>
                }
              />
            </Card>
          ) : tab === 'overrides' ? (
            <OverridesTable rows={roster.overrides} />
          ) : (
            <AdminTable caption={m('tab.vehicles')} columns={vehicleColumns} rows={vehicleRows} rowParam={false} />
          )}
        </TabPanel>
      </div>
    </ScreenFrame>
  );
}
