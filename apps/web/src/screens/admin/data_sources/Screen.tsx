// SPDX-License-Identifier: AGPL-3.0-only
import { date, time } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { FallbackPanel } from './FallbackPanel';
import { SuggestionsCard } from './SuggestionsCard';
import { FeedCards } from './FeedCards';
import { StageTable } from './StageTable';
import { ConnectSourceButton, SourcesHeader } from './SourcesHeader';
import styles from './DataSources.module.css';
import { loadSourcesView } from './view';

// Data Sources and Integrations. A Server Component: it reads through lib/data with
// the request context ModuleRoute built and passes plain data to the client files (the feed cards, the stage table, the
// fallback panel, the header). The page holds no search parameter besides the demo-mode review hook `?state=empty|loading|error`,
// which shows those states without reading data. A role with no access never reaches this screen; a view-only role would see
// every control disabled with the reason.
//
// STUBS, all labelled: the feed tests are scripted (Demo), the latency figures are Illustrative, "Connect a source" only shows a
// placeholder message (Demo), and guardrail 11 (no automatic stage without shadow results and a tested fallback) is not enforced
// by the data layer yet (the confirm dialog says "Not applied"). Rule 19 holds: The customer's dispatch stays the fallback.

const EXPORT_FILE = 'zone-stages.csv';

export async function DataSourcesScreen({ def, ctx, access, homeHref, locale: pageLocale, state }: ScreenProps) {
  const m = await getTranslations('admin.data_sources');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';
  const exportHeader = [t('common.zone'), m('shared.stage.label'), m('col.city'), m('col.updated')];

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        actions={<SourcesHeader canEdit={canEdit} zonesNotShadow={0} exportFilename={EXPORT_FILE} exportHeader={exportHeader} exportRows={undefined} />}
        emptyAction={<ConnectSourceButton canEdit={canEdit} />}
      />
    );
  }

  const view = await loadSourcesView(ctx);
  const exportRows = view.zones.map((zone) => [`${zone.name} (${zone.code})`, t(`opendispatch.stage.${zone.stage}`), zone.city, `${date(zone.updatedAt, { locale })} ${time(zone.updatedAt)}`]);

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      isEmpty={view.feeds.length === 0}
      emptyAction={<ConnectSourceButton canEdit={canEdit} />}
      actions={<SourcesHeader canEdit={canEdit} zonesNotShadow={view.zones.filter((zone) => zone.stage !== 'shadow').length} exportFilename={EXPORT_FILE} exportHeader={exportHeader} exportRows={exportRows} />}
    >
      <div className={styles.stack}>
        <StatStrip
          items={[
            { label: m('stat.healthy'), value: view.counts.healthy },
            { label: m('stat.degraded'), value: view.counts.degraded },
            { label: m('stat.off'), value: view.counts.off },
            { label: m('stat.timeout'), value: view.timeoutSeconds, unit: m('uom.s') },
          ]}
        />

        <section className={styles.stack} aria-labelledby="ds-feeds-title">
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle} id="ds-feeds-title">
              {m('feeds.title')}
            </h2>
            <IllustrativeLabel />
            <StubTag kind="demo" />
          </div>
          <FeedCards feeds={view.feeds} fallbackState={view.fallback.state} timeoutSeconds={view.timeoutSeconds} canEdit={canEdit} />
        </section>

        <section className={styles.stack} aria-labelledby="ds-live-title">
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle} id="ds-live-title">
              {m('live.title')}
            </h2>
          </div>
          <div className={styles.grid2}>
            <div className={styles.col}>
              <StageTable zones={view.zones} canEdit={canEdit} />
            </div>
            <aside className={styles.col}>
              <FallbackPanel fallback={view.fallback} timeoutSeconds={view.timeoutSeconds} deadlineMs={view.deadlineMs} canEdit={canEdit} />
              <SuggestionsCard saved={view.suggestions} canEdit={canEdit} />
            </aside>
          </div>
        </section>
      </div>
    </ScreenFrame>
  );
}
