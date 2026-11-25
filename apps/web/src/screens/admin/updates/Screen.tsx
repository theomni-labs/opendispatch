// SPDX-License-Identifier: AGPL-3.0-only
import { Alert, Badge, Card, DescriptionList, StatusPill, Timeline, type Tone } from '@opendispatch/ui';
import { date } from '@opendispatch/ui/format';
import { Check, PackageCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { ConnectionTab } from './ConnectionTab';
import { HistoryTab } from './HistoryTab';
import { OverviewTab } from './OverviewTab';
import { SettingsTab } from './SettingsTab';
import { WindowsTab } from './WindowsTab';
import { CheckNowButton, UpdatesHeader, UpdatesProvider } from './UpdatesHeader';
import { TABS, type FullUpdatesView, type ReducedUpdatesView } from './types';
import styles from './Updates.module.css';
import { loadUpdatesView } from './view';

// Updates. A Server Component: it reads through lib/data with the request context
// ModuleRoute built and passes plain data to the client files. The full screen (five tabs) is for private installs; the
// Administrator of a dedicated or shared install sees the reduced one (the version and the release notes only), because our
// staff apply updates there and every other read is refused and audited. The Change Approver (private only) sees the full
// screen read only and approves or rejects a scheduled update. THE UPDATE AGENT IS A SCRIPTED STUB: the screen carries a "Demo"
// tag next to the version, and the download, verification and restore phases move on with the clock of the data layer (the
// Overview asks again while one is under way). `?state=empty|loading|error` (demo-mode review hook) shows those states without
// reading data. The address holds: ?tab= ?release= ?window=edit ?blackout=new.

const STATE_PILL: Readonly<Record<string, { tone: Tone; key: 'state.downloading' | 'state.verifying' | 'state.verify_failed' | 'state.needs_attention' | 'state.restore_requested' | 'state.restore_in_progress' }>> = {
  downloading: { tone: 'info', key: 'state.downloading' },
  verifying: { tone: 'info', key: 'state.verifying' },
  verify_failed: { tone: 'danger', key: 'state.verify_failed' },
  needs_attention: { tone: 'danger', key: 'state.needs_attention' },
  restore_requested: { tone: 'warning', key: 'state.restore_requested' },
  restore_in_progress: { tone: 'warning', key: 'state.restore_in_progress' },
};

export async function UpdatesScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.updates');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        meta={<StubTag kind="demo" />}
        actions={access.reduced ? undefined : <UpdatesHeader canEdit={canEdit} offline={false} />}
        emptyAction={<CheckNowButton canEdit={canEdit} offline={false} variant="secondary" />}
      />
    );
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    release: param.pattern(/^[0-9]+\.[0-9]+\.[0-9]+$/, 32),
    window: param.enum(['edit'] as const),
    blackout: param.enum(['new'] as const),
  });
  const view = await loadUpdatesView(ctx, { reduced: access.reduced, locale, query: { release: query.release } });

  if (view.kind === 'reduced') {
    return (
      <ScreenFrame def={def} access={access} homeHref={homeHref} meta={<StubTag kind="demo" />}>
        <ReducedBody view={view} locale={locale} modeLabel={t(`installModes.${view.installMode}`)} title={{ notes: m('rn.title'), version: m('rv.title'), channel: m('channel'), install: m('rv.install'), managed: m('rv.managed'), stable: m('ch.stable'), hotfix: m('ch.hotfix') }} />
      </ScreenFrame>
    );
  }

  const tab = query.tab ?? 'overview';
  const full: FullUpdatesView = view;
  const overview = full.overview;
  const pill = overview.mode === 'needs_attention' || overview.mode === 'restore_requested' || overview.mode === 'restore_in_progress' ? STATE_PILL[overview.mode] : overview.release?.stage === undefined || overview.release.stage === null ? undefined : STATE_PILL[overview.release.stage];
  const meta = (
    <>
      <span title={m('version')}>
        <Badge icon={<PackageCheck />}>
          <span translate="no">v{full.status.currentVersion}</span>
        </Badge>
      </span>
      {pill === undefined ? null : <StatusPill status={m(pill.key)} tone={pill.tone} size="sm" />}
      <StubTag kind="demo" />
    </>
  );
  const offline = full.status.connectionMode === 'offline';
  const failedEntry = overview.recovery === null ? undefined : full.history.find((row) => row.version === overview.recovery?.version && row.result === 'failed');
  const openWindows = full.windows.upcoming.filter((slot) => slot.open).slice(0, 5).map((slot) => ({ start: slot.start, end: slot.end, open: slot.open, blockedByBlackout: slot.blockedByBlackout }));

  return (
    <UpdatesProvider emergency={full.emergency} canEdit={canEdit}>
      <ScreenFrame
        def={def}
        access={access}
        homeHref={homeHref}
        meta={meta}
        actions={<UpdatesHeader canEdit={canEdit} offline={offline} />}
        tabs={
          <UrlTabs
            id="up"
            ariaLabel={m('tabs.label')}
            defaultTab="overview"
            resetParams={['release', 'window', 'blackout']}
            tabs={TABS.map((value) => ({ value, label: m(`tab.${value}`) }))}
          />
        }
      >
        <TabPanel id="up" value={tab}>
          {tab === 'overview' ? <OverviewTab overview={overview} status={full.status} recurring={full.windows.recurring} openWindows={openWindows} history={{ failedStartedAt: failedEntry?.startedAt ?? null }} canEdit={canEdit} /> : null}
          {tab === 'connection' ? <ConnectionTab connection={full.connection} canEdit={canEdit} /> : null}
          {tab === 'windows' ? <WindowsTab windows={full.windows} canEdit={canEdit} windowOpen={query.window === 'edit' && canEdit} blackoutOpen={query.blackout === 'new' && canEdit} /> : null}
          {tab === 'history' ? <HistoryTab rows={full.history} /> : null}
          {tab === 'settings' ? <SettingsTab settings={full.settings} canEdit={canEdit} /> : null}
        </TabPanel>
      </ScreenFrame>
    </UpdatesProvider>
  );
}

interface ReducedTitles {
  readonly notes: string;
  readonly version: string;
  readonly channel: string;
  readonly install: string;
  readonly managed: string;
  readonly stable: string;
  readonly hotfix: string;
}

/** The reduced screen: release notes and version, and nothing that acts. */
function ReducedBody({ view, locale, modeLabel, title }: { view: ReducedUpdatesView; locale: 'en' | 'ar'; modeLabel: string; title: ReducedTitles }) {
  return (
    <div className={styles.grid2}>
      <Card padding="lg">
        <div className={styles.cardInner}>
          <div className={styles.head}>
            <h2 className={styles.cardTitle}>{title.notes}</h2>
          </div>
          <Timeline
            items={view.notes.map((note) => ({
              id: note.version,
              title: <span translate="no">v{note.version}</span>,
              time: date(note.publishedAt, { locale }),
              description: note.text,
              tone: 'success' as const,
              icon: <Check />,
            }))}
          />
        </div>
      </Card>
      <aside className={styles.col}>
        <Card padding="lg">
          <div className={styles.cardInner}>
            <div className={styles.head}>
              <h2 className={styles.cardTitle}>{title.version}</h2>
              <Badge>
                <span translate="no">v{view.currentVersion}</span>
              </Badge>
            </div>
            <DescriptionList
              dense
              columns={1}
              items={[
                { label: title.channel, value: view.channel === 'hotfix' ? title.hotfix : title.stable },
                { label: title.install, value: modeLabel },
              ]}
            />
            <Alert tone="info">{title.managed}</Alert>
          </div>
        </Card>
      </aside>
    </div>
  );
}
