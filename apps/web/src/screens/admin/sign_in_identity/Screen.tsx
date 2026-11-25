// SPDX-License-Identifier: AGPL-3.0-only
import { Card, StatusPill } from '@opendispatch/ui';
import { date } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { AdminTableColumn, AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { AdminTable } from '@/components/opendispatch/patterns/AdminTable';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { EmergencyTab } from './EmergencyTab';
import { AddProviderButton, IdentityHeader, KeycloakBanner, ReadOnlyBanner } from './IdentityHeader';
import { PolicyPanel } from './PolicyPanel';
import { DomainList, ProtocolBadge, ProviderDrawer, SyncPill } from './ProviderDrawer';
import { ProviderWizard } from './ProviderWizard';
import { RuleDrawer, RulesPanel, RuleToggle, ScopeCell } from './RulesPanel';
import styles from './SignIn.module.css';
import { TABS, type ProviderRow, type RuleRow } from './types';
import { loadIdentityView } from './view';

// Sign-in and Identity Providers: four tabs, two drawers and a four-step wizard. A Server Component: it
// reads through lib/data with the request context ModuleRoute built and passes plain data to the client files. Tab, the open
// provider, the open rule and the wizard live in the address (?tab= ?provider= ?rule= ?wizard=); each is checked here against
// an allow-list. Administrator edits (private and dedicated installs); in a shared install the Administrator has `view`: a banner
// says our staff manage providers there, every write control is disabled with the reason, and "Request a change" asks for one.
// `?state=empty|loading|error` (demo-mode review hook) shows those states without reading data.

const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const RULE_ID = /^(new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

type Translate = Awaited<ReturnType<typeof getTranslations>>;

export async function SignInIdentityScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.sign_in_identity');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<IdentityHeader canEdit={canEdit} exportJson={undefined} />} emptyAction={<AddProviderButton canEdit={canEdit} variant="secondary" showReason />} />;
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    provider: param.pattern(PROVIDER_ID, 64),
    rule: param.pattern(RULE_ID, 36),
    wizard: param.pattern(/^(1|[A-Za-z0-9][A-Za-z0-9_.:-]{0,63})$/, 64),
  });
  const view = await loadIdentityView(ctx, query);
  const tab = query.tab ?? 'providers';

  const tabs = (
    <UrlTabs
      id="si"
      ariaLabel={m('tabs.label')}
      defaultTab="providers"
      resetParams={['id', 'provider', 'rule', 'wizard']}
      tabs={[
        { value: 'providers', label: m('tab.providers'), count: view.providers.length },
        { value: 'rules', label: m('tab.rules'), count: view.rules.length },
        { value: 'policy', label: m('tab.policy') },
        { value: 'emergency', label: m('tab.emergency') },
      ]}
    />
  );

  const providerColumns: AdminTableColumn[] = [
    { key: 'name', header: m('col.name') },
    { key: 'preset', header: m('col.preset') },
    { key: 'protocol', header: m('col.protocol') },
    { key: 'domains', header: m('col.domains'), hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
    { key: 'sync', header: m('col.sync') },
    { key: 'test', header: m('col.test'), hideBelow: 'lg' },
  ];
  const ruleColumns: AdminTableColumn[] = [
    { key: 'priority', header: '#', align: 'end' },
    { key: 'group', header: m('col.group') },
    { key: 'role', header: m('prev.role') },
    { key: 'zone', header: t('common.zone') },
    { key: 'on', header: m('col.on'), align: 'center' },
  ];
  const nextPriority = Math.max(0, ...view.rules.map((rule) => rule.priority)) + 1;

  const notices: ReactNode[] = [];
  if (view.unknown.provider) notices.push(<RecordNotice key="provider" param="provider" message={m('notice.provider')} />);
  if (view.unknown.rule) notices.push(<RecordNotice key="rule" param="rule" message={m('notice.rule')} />);
  if (view.unknown.wizard) notices.push(<RecordNotice key="wizard" param="wizard" message={m('notice.provider')} />);

  const rulesRows = view.rules.map((rule) => ruleRow(rule, m, t, canEdit));

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      tabs={tabs}
      isEmpty={view.providers.length === 0}
      emptyAction={<AddProviderButton canEdit={canEdit} variant="secondary" showReason />}
      overlays={
        <>
          <ProviderDrawer provider={view.openProvider} canEdit={canEdit} keycloakConnected={view.keycloakConnected} />
          <RuleDrawer key={view.openRule === undefined ? 'none' : view.openRule === 'new' ? 'new' : view.openRule.id} rule={view.openRule} zones={view.zones} roleOptions={view.roleOptions} nextPriority={nextPriority} canEdit={canEdit} />
          <ProviderWizard key={view.wizard === undefined ? 'closed' : view.wizard.mode === 'new' ? 'new' : view.wizard.provider.id} target={view.wizard} presets={view.presets} canEdit={canEdit} keycloakConnected={view.keycloakConnected} />
        </>
      }
      actions={<IdentityHeader canEdit={canEdit} exportJson={view.exportJson} />}
    >
      <div className={styles.stack}>
        {canEdit ? null : <ReadOnlyBanner />}
        {canEdit && !view.keycloakConnected ? <KeycloakBanner /> : null}
        {notices}
        {tab === 'providers' ? (
          <TabPanel id="si" value="providers">
            <Card padding="none">
              <AdminTable caption={m('tab.providers')} columns={providerColumns} rows={view.providers.map((provider) => providerRow(provider, m, locale))} rowParam="provider" pageSize={0} />
            </Card>
          </TabPanel>
        ) : null}
        {tab === 'rules' ? (
          <TabPanel id="si" value="rules">
            <RulesPanel columns={ruleColumns} rows={rulesRows} rules={view.rules} caption={m('tab.rules')} samples={view.samples} initialGroups={view.initialGroups} initialPreview={view.initialPreview} canEdit={canEdit} />
          </TabPanel>
        ) : null}
        {tab === 'policy' ? (
          <TabPanel id="si" value="policy">
            <PolicyPanel policy={view.policy} canEdit={canEdit} />
          </TabPanel>
        ) : null}
        {tab === 'emergency' && view.emergency !== undefined ? (
          <TabPanel id="si" value="emergency">
            <EmergencyTab emergency={view.emergency} policy={view.policy} canEdit={canEdit} locale={locale} />
          </TabPanel>
        ) : null}
      </div>
    </ScreenFrame>
  );
}

function providerRow(provider: ProviderRow, m: Translate, locale: 'en' | 'ar'): AdminTableRow {
  return {
    id: provider.id,
    label: provider.name,
    cells: {
      name: (
        <span>
          <span className={styles.cellMain} translate="no">
            {provider.name}
          </span>
          {provider.mock ? <span className={styles.cellSub}>{m('demo')}</span> : null}
        </span>
      ),
      preset: <span translate="no">{provider.presetName}</span>,
      protocol: <ProtocolBadge protocol={provider.protocol} />,
      domains: (
        <span className={styles.muted}>
          <DomainList domains={provider.domains} />
        </span>
      ),
      status: <StatusPill status={m(provider.enabled ? 'status.on' : 'status.off')} tone={provider.enabled ? 'success' : 'neutral'} size="sm" />,
      sync: provider.sync === null ? <span className={styles.muted}>-</span> : <SyncPill status={provider.sync.status} />,
      test:
        provider.lastTest === null ? (
          <span className={styles.muted}>{m('test.none')}</span>
        ) : (
          <span className={styles.inline}>
            <StatusPill status={m(provider.lastTest.ok ? 'test.pass' : 'test.fail')} tone={provider.lastTest.ok ? 'success' : 'danger'} size="sm" />
            {provider.lastTest.at === null ? null : <span className={styles.meta}>{date(provider.lastTest.at, { locale })}</span>}
          </span>
        ),
    },
  };
}

function ruleRow(rule: RuleRow, m: Translate, t: Translate, canEdit: boolean): AdminTableRow {
  const muted = !rule.enabled || !rule.live ? styles.muted : undefined;
  return {
    id: rule.id,
    label: rule.match,
    cells: {
      priority: <span translate="no">{rule.priority}</span>,
      group: (
        <span className={muted}>
          <span className={styles.cellMain} translate="no">
            {rule.match}
          </span>
          <span className={styles.cellSub}>{m(`match.${rule.matchType}`)}</span>
        </span>
      ),
      role: (
        <span className={muted}>
          {t(`roles.${rule.role}`)}
          {rule.live ? null : <span className={styles.cellSub}>{m('private')}</span>}
        </span>
      ),
      zone: (
        <span className={muted}>
          <ScopeCell role={rule.role} codes={rule.zoneCodes} />
        </span>
      ),
      on: <RuleToggle ruleId={rule.id} enabled={rule.enabled} canEdit={canEdit} />,
    },
  };
}
