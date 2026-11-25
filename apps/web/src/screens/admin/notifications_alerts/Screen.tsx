// SPDX-License-Identifier: AGPL-3.0-only
import { date, time } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { AlertPreview } from './AlertPreview';
import { QuietDrawer, RuleDrawer } from './Drawers';
import { LogTable } from './LogTab';
import { NotificationsHeader, SendTestButton } from './NotificationsHeader';
import { QuietCard, RulesTable } from './RulesTab';
import { CATEGORIES, CHANNELS, READ_STATES, SEVERITIES, TABS } from './types';
import styles from './Notifications.module.css';
import { filterLog, filterRules, loadNotificationsView } from './view';

// Notifications and Alerts. A Server Component: it reads through lib/data with the request context
// ModuleRoute built and passes plain data to the client files (the rule table, the preview, the quiet-hours card, the log and the
// two drawers). Tab, search, filters, page, the open rule and the quiet-hours drawer live in the address (?tab= ?q= ?severity=
// ?channel= ?category= ?read= ?page= ?rule= ?quiet=1); each is checked here against an allow-list. `?state=empty|loading|error`
// (demo-mode review hook) shows those states without reading data. A role with no access never reaches this screen; a view-only role
// sees every control disabled with the reason.
//
// ONLY IN-APP NOTIFICATIONS EXIST: no e-mail is sent, and the rule drawer says so beside the e-mail channel. QUIET HOURS ARE
// STORED, NOT APPLIED: the card, the drawer, the stat and the preview carry the "Not applied" tag.

const first = (value: string | readonly string[] | undefined): string | undefined => (typeof value === 'string' ? value : value?.[0]);

export async function NotificationsAlertsScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.notifications_alerts');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';
  const exportHeader = [m('col.time'), m('col.alert'), m('col.category'), m('col.severity'), m('col.to'), t('common.status')];

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        actions={<NotificationsHeader canEdit={canEdit} testRuleId={undefined} exportHeader={exportHeader} exportRows={undefined} />}
        emptyAction={<SendTestButton canEdit={canEdit} ruleId={undefined} variant="secondary" />}
      />
    );
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    q: param.text(80),
    severity: param.enum(SEVERITIES),
    channel: param.enum(CHANNELS),
    category: param.enum(CATEGORIES),
    read: param.enum(READ_STATES),
    rule: param.id(),
    quiet: param.flag(),
    page: param.int(1, 1000),
  });
  const view = await loadNotificationsView(ctx, query, first(searchParams['rule']));
  const tab = query.tab ?? 'rules';
  const rules = filterRules(view.rules, query, (event) => m(`ev.${event}`));
  const alerts = filterLog(view.log, query);
  const testRule = view.rules.find((rule) => rule.enabled);

  const roleName = (role: string) => t(`roles.${role}`);
  const exportRows = alerts.map((alert) => [
    `${date(alert.at, { locale })}, ${time(alert.at)}`,
    locale === 'ar' && alert.titleAr !== null ? alert.titleAr : alert.title,
    m(`cat.${alert.category}`),
    m(`sev.${alert.severity}`),
    alert.toName ?? (alert.toRole === null ? '-' : roleName(alert.toRole)),
    alert.read ? m('f.read') : m('f.unread'),
  ]);

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      actions={<NotificationsHeader canEdit={canEdit} testRuleId={testRule?.id} noRule={testRule === undefined} exportHeader={exportHeader} exportRows={exportRows} />}
      tabs={
        <UrlTabs
          id="na"
          ariaLabel={m('tabs.label')}
          defaultTab="rules"
          resetParams={['q', 'severity', 'channel', 'category', 'read', 'rule', 'quiet', 'page']}
          tabs={[
            { value: 'rules', label: m('tab.rules'), count: view.rules.length },
            { value: 'log', label: m('tab.log'), count: view.log.length },
          ]}
        />
      }
    >
      <div className={styles.stack}>
        {view.unknownRule ? <RecordNotice param="rule" message={m('notice.ruleNotFound')} /> : null}
        <StatStrip
          items={[
            { label: m('stat.rules'), value: view.rulesOn },
            { label: m('stat.unread'), value: view.unread },
            { label: m('stat.critical'), value: view.critical },
            { label: m('stat.quiet'), value: view.quiet.enabled ? m('range', { from: view.quiet.start, to: view.quiet.end }) : t('common.off'), hint: t('patterns.stub.notApplied') },
          ]}
        />
        <TabPanel id="na" value={tab}>
          {tab === 'rules' ? (
            <div className={styles.grid2}>
              <RulesTable rules={rules} canEdit={canEdit} page={query.page} emptyState={<NoMatch title={m('none')} clearParams={['q', 'severity', 'channel']} />} />
              <aside className={styles.col}>
                <AlertPreview rules={view.rules} quiet={view.quiet} me={view.me} />
                <QuietCard quiet={view.quiet} canEdit={canEdit} />
              </aside>
            </div>
          ) : null}
          {tab === 'log' ? (
            <LogTable
              alerts={alerts}
              total={view.log.length}
              canEdit={canEdit}
              page={query.page}
              emptyState={<NoMatch title={m('none')} clearParams={['q', 'severity', 'category', 'read']} />}
              emptyAction={<SendTestButton canEdit={canEdit} ruleId={testRule?.id} noRule={testRule === undefined} variant="secondary" />}
            />
          ) : null}
        </TabPanel>
        <RuleDrawer rule={view.openRule} canEdit={canEdit} />
        <QuietDrawer open={query.quiet === true} quiet={view.quiet} canEdit={canEdit} />
      </div>
    </ScreenFrame>
  );
}
