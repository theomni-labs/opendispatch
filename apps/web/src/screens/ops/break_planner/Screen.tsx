// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Button, Card, EmptyState, Tag } from '@opendispatch/ui';
import { time } from '@opendispatch/ui/format';
import { ChevronRight, CircleCheck, Clock, Coffee, Gauge } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AdjustDrawer } from './AdjustDrawer';
import { ConflictsTable } from './ConflictsTable';
import { HeaderActions } from './HeaderActions';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip, type StatItem } from '@/components/opendispatch/patterns/StatStrip';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { RosterBand, RosterRow } from '@/components/opendispatch/RosterGrid';
import { TimeRibbon } from '@/components/opendispatch/TimeRibbon';
import type { RibbonSegment } from '@/components/opendispatch/ribbon-geometry';
import type { ScreenProps } from '@/screens/types';
import { PickerBar } from './PickerBar';
import { ShiftTimeline } from './ShiftTimeline';
import styles from './BreakPlanner.module.css';
import { BP_TABS } from './types';
import { loadBreakPlannerView } from './view';

// Break Planner (ops module 10

export async function BreakPlannerScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.break_planner');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} />;
  }

  const query = parseSearchParams(searchParams, {
    zone: param.id(),
    date: param.pattern(/^\d{4}-\d{2}-\d{2}$/, 10),
    tab: param.enum(BP_TABS),
    shift: param.id(),
    adjust: param.id(),
  });
  const view = await loadBreakPlannerView(ctx, { zone: query.zone, date: query.date }, locale);
  const roster = view.roster;
  const tab = roster === undefined ? 'timeline' : (query.tab ?? 'timeline');

  const generateReason = !canEdit ? t('opendispatch.gate.viewOnly') : roster === undefined ? m('need.noRoster') : !roster.editable ? m('need.notEditable') : null;

  const subtitle =
    view.zone.name === '' ? undefined : (
      <span translate="no">
        {view.zone.name} · {view.dateLabel}
      </span>
    );

  if (roster === undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        homeHref={homeHref}
        sources={view.sources}
        description={subtitle}
        isEmpty
        emptyAction={
          view.zone.id === '' ? undefined : (
            <Button variant="secondary" href={`/ops/field-planner?${new URLSearchParams({ zone: view.zone.id, date: view.date }).toString()}`} endIcon={<ChevronRight />}>
              {m('empty.action')}
            </Button>
          )
        }
        actions={<HeaderActions zoneId={view.zone.id} date={view.date} generateReason={generateReason} />}
      >
        {view.zone.id === '' ? null : <PickerBar zoneOptions={view.zoneOptions} zoneId={view.zone.id} date={view.date} prevDate={view.prevDate} nextDate={view.nextDate} />}
      </ScreenFrame>
    );
  }

  const stats: StatItem[] = [
    { label: m('stat.breaks'), value: roster.stats.breaks, hint: <IllustrativeLabel /> },
    { label: m('stat.conflicts'), value: roster.stats.conflicts, hint: <IllustrativeLabel /> },
    { label: m('stat.holds'), value: roster.stats.holds, hint: <IllustrativeLabel /> },
    { label: m('stat.peak'), value: roster.stats.peak, hint: <IllustrativeLabel /> },
  ];

  const windowMin = roster.policy.windowMinutes;
  const ribbonSegments: RibbonSegment[] = roster.prayerChips.map((p) => ({
    from: p.minute / 60,
    to: (p.minute + windowMin) / 60,
    label: `${m(`prayer.${p.name}`)} ${time(p.minute)}`,
    tone: 4,
  }));

  const tabs = (
    <UrlTabs
      id="bp"
      ariaLabel={m('slots.title')}
      defaultTab="timeline"
      selected={tab}
      tabs={[
        { value: 'timeline', label: m('tab.timeline') },
        { value: 'conflicts', label: m('tab.conflicts'), count: roster.conflictRows.length },
      ]}
    />
  );

  const adjustTarget = query.adjust === undefined ? undefined : roster.rows.find((r) => r.assignmentId === query.adjust);
  const editReason = generateReason;

  const group = roster.shifts.find((s) => s.id === query.shift) ?? roster.shifts[0];
  const shiftOptions = roster.shifts.map((s) => ({ value: s.id, label: `${s.label} ${time(s.startMin)}–${time(s.endMin % 1440)}` }));
  const startMin = group?.startMin ?? 360;
  const endMin = group?.endMin ?? 1800;
  const inShift = roster.prayers.filter((p) => p.minute + windowMin > startMin && p.minute < endMin);
  const bands: RosterBand[] = inShift.map((p) => ({ from: p.minute / 60, to: (p.minute + windowMin) / 60 }));
  const prayerRow: RosterRow = {
    id: 'prayer-row',
    name: m('leg.prayer'),
    nameIsData: false,
    blocks: inShift.map((p) => ({ kind: 'prayer', from: p.minute / 60, to: (p.minute + windowMin) / 60, label: `${m(`prayer.${p.name}`)} ${time(p.minute)}` })),
  };
  const groupIds = new Set(group?.rowIds ?? []);
  const shiftRows = roster.gridRows.filter((r) => groupIds.has(r.id));

  return (
    <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={subtitle} actions={<HeaderActions zoneId={view.zone.id} date={view.date} generateReason={generateReason} />}>
      <div className={styles.stack}>
        <PickerBar zoneOptions={view.zoneOptions} zoneId={view.zone.id} date={view.date} prevDate={view.prevDate} nextDate={view.nextDate} />

        <StatStrip items={stats} />

        <Card padding="lg">
          <div className={styles.cardTitleRow}>
            <h2 className={styles.cardTitle}>{m('pr.title')}</h2>
          </div>
          <div className={styles.badgeRow}>
            <Badge icon={<Clock />}>{m('pr.windowN', { n: windowMin })}</Badge>
            <Badge icon={<Coffee />}>{m('pr.rule')}</Badge>
          </div>
          <div className={styles.body}>
            <div className={styles.prayerChips}>
              {roster.prayerChips.map((p) => (
                <Tag key={p.name} color="green">
                  <span>{m(`prayer.${p.name}`)}</span> <span translate="no">{time(p.minute)}</span>
                </Tag>
              ))}
            </div>
            <TimeRibbon label={m('pr.title')} segments={ribbonSegments} tickEvery={3} />
          </div>
        </Card>

        <Card padding="none">
          <div className={styles.cardHeadRow}>
            <div className={styles.cardTitleRow}>
              <h2 className={styles.cardTitle}>{m('slots.title')}</h2>
              <IllustrativeLabel />
              {roster.coverageCost === undefined ? null : (
                <Badge icon={<Gauge />}>
                  {m('slots.cost', { n: roster.coverageCost.expected_cases.toFixed(1) })}
                </Badge>
              )}
              <Badge tone="info" icon={<Coffee />}>
                <span data-testid="bp-policy">{m(`policy.${roster.policy.mode}`)}</span>
              </Badge>
            </div>
          </div>

          <div className={styles.cardBody}>
            {tabs}
            <TabPanel id="bp" value={tab}>
              {tab === 'timeline' ? (
                <ShiftTimeline
                  shifts={shiftOptions}
                  shift={group?.id ?? ''}
                  rows={shiftRows.length === 0 ? [] : [prayerRow, ...shiftRows]}
                  bands={bands}
                  startHour={Math.floor(startMin / 60)}
                  endHour={Math.ceil(endMin / 60)}
                />
              ) : (
                <ConflictsTable
                  rows={roster.conflictRows}
                  date={view.date}
                  prayers={roster.prayers}
                  policy={roster.policy}
                  caption={m('tab.conflicts')}
                  emptyState={<EmptyState compact icon={<CircleCheck />} title={m('rows.empty')} />}
                  disabledReason={editReason}
                />
              )}
            </TabPanel>
          </div>
        </Card>
      </div>

      <AdjustDrawer target={adjustTarget} date={view.date} prayers={roster.prayers} policy={roster.policy} disabledReason={editReason} />
    </ScreenFrame>
  );
}
