// SPDX-License-Identifier: AGPL-3.0-only
import { Card } from '@opendispatch/ui';
import { summariseAlerts, summariseHandover } from '@/components/opendispatch/assistant/actions';
import { assistantAvailability } from '@/components/opendispatch/assistant/availability';
import { getTranslations } from 'next-intl/server';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { MapView } from '@/components/opendispatch/MapView';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import { ShadowComparisonList } from '@/components/opendispatch/ShadowComparisonList';
import { AgentStatusLegend } from '@/components/opendispatch/AgentStatusLegend';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import type { ScreenProps } from '@/screens/types';
import { Board } from './Board';
import { CaseAiDrawer } from './CaseAiDrawer';
import { loadCaseAiCard } from '@/components/opendispatch/assistant/caseCard';
import { FallbackAlert } from './FallbackPanel';
import { Figures } from './Figures';
import { HeaderActions } from './HeaderActions';
import styles from './LiveDispatchBoard.module.css';
import { ReadingPanel } from './ReadingPanel';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { UnmetLog } from './UnmetLog';
import { WaitingSpotList } from './WaitingSpotList';
import { UNMET_CAUSES } from './unmet';
import { BOARD_TABS, REASON_CODES, type BoardTab } from './types';
import { loadLiveDispatchView, unreadAlertCount } from './view';

// Live Dispatch Board (Ops 2, flow 11; the operator fallback rules-20).

const TAB_RESET = ['ur_zone', 'ur_day', 'ur_cause', 'ai'] as const;

export async function LiveDispatchBoardScreen({ def, ctx, access, homeHref, locale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.live_dispatch_board');
  const t = await getTranslations();
  const canEdit = access.access === 'edit';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<HeaderActions status="stopped" outageActive={false} canEdit={canEdit} />} />;
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(BOARD_TABS),
    ur_zone: param.id(),
    ur_day: param.pattern(/^\d{4}-\d{2}-\d{2}$/, 10),
    ur_cause: param.enum(UNMET_CAUSES),
    ai: param.id(),
  });
  const [view, assistant, unread] = await Promise.all([
    loadLiveDispatchView(ctx, locale, { zone: query.ur_zone, day: query.ur_day, cause: query.ur_cause }),
    assistantAvailability(ctx),
    unreadAlertCount(ctx),
  ]);
  const aiCase = query.ai === undefined ? undefined : Object.values(view.columns).flat().find((c) => c.caseId === query.ai);
  const aiCard = aiCase === undefined ? null : await loadCaseAiCard(ctx, aiCase.caseId, 'live_dispatch_board', locale);
  const mapLegend = [
    ...view.map.legend.map((item) => ({ dot: item.status, label: t(`opendispatch.status.${item.status}`) })),
    { dot: 'case' as const, label: m('map.perZone') },
    ...(view.map.spots ? [{ dot: 'spot' as const, label: m('map.spot') }] : []),
  ];
  const reasonOptions = REASON_CODES.map((code) => ({ value: code, label: t(`opendispatch.reasonCode.${code}`) }));
  const columnLabels = { waiting: m('board.col.waiting'), recommended: m('board.col.recommended'), progress: m('col.progress') };
  const tabs: BoardTab[] = BOARD_TABS.filter((tab) => tab !== 'spots' || view.waiting.enabled);
  const tab: BoardTab = query.tab !== undefined && tabs.includes(query.tab) ? query.tab : 'board';
  const handover =
    assistant !== null && assistant.handover
      ? { handoverAction: summariseHandover, alertsAction: summariseAlerts, configured: assistant.configured, alertsDigest: assistant.alertsDigest, unread }
      : undefined;
  const counts: Partial<Record<BoardTab, number>> = { board: view.totalCases, spots: view.waiting.rows.length, reach: view.unmet.rows.length };

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      description={m('sub', { date: view.replay.dateBoth, time: view.replay.time })}
      isEmpty={view.totalCases === 0}
      actions={<HeaderActions status={view.replay.status} outageActive={view.replay.feedOutageActive} canEdit={canEdit} handover={handover} />}
      overlays={<CaseAiDrawer card={aiCard} subtitle={aiCase === undefined ? null : `${aiCase.caseNumber} · ${aiCase.zoneCode}`} canEdit={canEdit} />}
    >
      <div className={styles.stack}>
        <Figures waiting={view.columns.waiting.length} overReach={view.overReachToday} reading={view.reading} fallback={view.fallback} stages={view.stages} />
        <FallbackAlert fallback={view.fallback} />
        <div className={styles.tabs}>
          <UrlTabs
            id="ldb"
            ariaLabel={m('tab.label')}
            defaultTab="board"
            selected={tab}
            resetParams={TAB_RESET}
            tabs={tabs.map((value) => ({ value, label: m(`tab.${value}`), ...(counts[value] === undefined ? {} : { count: counts[value] }) }))}
          />
          <TabPanel id="ldb" value={tab}>
            {tab === 'board' ? (
              <Board columns={view.columns} columnLabels={columnLabels} emptyText={m('board.empty')} canEdit={canEdit} reasonOptions={reasonOptions} />
            ) : tab === 'map' ? (
              <Card padding="none">
                <div className={styles.mapHead}>
                  <h2 className={styles.cardTitle}>{m('map.title')}</h2>
                  <div className={styles.mapLegend}>
                    <AgentStatusLegend items={view.map.legend} />
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <MapView zones={view.map.zones} pins={view.map.pins} links={view.map.links} label={m('map.title')} legend={mapLegend} height={420} fit="main" />
                </div>
              </Card>
            ) : tab === 'spots' ? (
              <WaitingSpotList waiting={view.waiting} locale={locale} />
            ) : tab === 'reach' ? (
              <UnmetLog unmet={view.unmet} locale={locale} />
            ) : (
              <div className={styles.detailGrid}>
                <Card padding="none">
                  <div className={styles.mapHead}>
                    <h2 className={styles.cardTitle}>{m('cmp.title')}</h2>
                    <div className={styles.mapLegend}>
                      <IllustrativeLabel />
                    </div>
                  </div>
                  <div className={styles.cardBody}>
                    <ShadowComparisonList rows={view.comparisons} />
                  </div>
                </Card>
                <ReadingPanel reading={view.reading} />
              </div>
            )}
          </TabPanel>
        </div>
      </div>
    </ScreenFrame>
  );
}
