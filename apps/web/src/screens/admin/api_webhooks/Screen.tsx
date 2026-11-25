// SPDX-License-Identifier: AGPL-3.0-only
import { Card, CardHeader, DescriptionList, StatusPill, Badge } from '@opendispatch/ui';
import { date, time } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { AddHookButton, ApiHeader, ClientCreate, CreateClientButton, HookDrawer } from './ApiForms';
import { LimitsPanel, RetryButton, RevokeButton, RotateButton, ScopeTag, TestHookButton } from './ApiTables';
import styles from './ApiWebhooks.module.css';
import { TABS, type ClientRow, type DeliveryRow, type HookRow } from './types';
import { loadApiView } from './view';

// API and Webhooks: four tabs (API clients, Webhooks, Delivery log, Rate limits), three figures, a drawer to
// create a client (and the dialog that shows its key once) and one for a webhook. A Server Component: it reads through lib/data
// with the request context ModuleRoute built and passes plain data to the client files. Tab, the log's search and status filter,
// the open webhook and the create drawer live in the address (?tab= ?q= ?status= ?hook= ?client=); each is checked here against
// an allow-list. A view-only role would see every control disabled with the reason (only the Administrator has this module, and
// edits). Stubs: the webhook test and the retry send nothing (Demo); the rate limits and the retry policy are Illustrative and
// stored, not enforced (Not applied). `?state=empty|loading|error` (demo-mode review hook) shows those states without reading data.

const HOOK_ID = /^(new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

type Translate = Awaited<ReturnType<typeof getTranslations>>;

export async function ApiWebhooksScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.api_webhooks');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';
  const exportHeader = [m('col.time'), m('col.hook'), m('col.event'), t('common.status'), 'HTTP', m('col.attempts')];
  const exportFilename = 'webhook-deliveries.csv';

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        actions={<ApiHeader canEdit={canEdit} exportRows={undefined} exportHeader={exportHeader} exportFilename={exportFilename} />}
        emptyAction={<CreateClientButton canEdit={canEdit} variant="secondary" showReason />}
        overlays={<ClientCreate open={searchParams['client'] === 'new' && canEdit} canEdit={canEdit} />}
      />
    );
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    q: param.text(80),
    status: param.enum(['succeeded', 'failed']),
    hook: param.pattern(HOOK_ID, 36),
    client: param.enum(['new']),
    page: param.int(1, 1000),
  });
  const view = await loadApiView(ctx, { q: query.q, status: query.status, hook: query.hook });
  const tab = query.tab ?? 'clients';

  const tabs = (
    <UrlTabs
      id="aw"
      ariaLabel={m('tabs.label')}
      defaultTab="clients"
      resetParams={['q', 'sort', 'id', 'new', 'status', 'hook', 'client']}
      tabs={[
        { value: 'clients', label: m('tab.clients') },
        { value: 'hooks', label: m('tab.hooks') },
        { value: 'log', label: m('tab.log') },
        { value: 'limits', label: m('tab.limits') },
      ]}
    />
  );

  const clientColumns: AdminTableColumn[] = [
    { key: 'client', header: m('col.client') },
    { key: 'scopes', header: m('col.scopes') },
    { key: 'key', header: m('col.key'), hideBelow: 'md' },
    { key: 'used', header: m('col.lastUsed'), hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
    { key: 'actions', header: m('col.actions'), align: 'end' },
  ];
  const hookColumns: AdminTableColumn[] = [
    { key: 'hook', header: m('col.hook') },
    { key: 'events', header: m('col.events'), hideBelow: 'md' },
    { key: 'last', header: m('col.lastDelivery') },
    { key: 'status', header: t('common.status') },
    { key: 'actions', header: m('col.actions'), align: 'end' },
  ];
  const logColumns: AdminTableColumn[] = [
    { key: 'time', header: m('col.time') },
    { key: 'hook', header: m('col.hook'), hideBelow: 'md' },
    { key: 'event', header: m('col.event') },
    { key: 'status', header: t('common.status') },
    { key: 'attempts', header: m('col.attempts'), align: 'end' },
    { key: 'actions', header: m('col.actions'), align: 'end' },
  ];

  const exportRows = view.deliveries.map((delivery) => [`${date(delivery.at, { locale })} ${time(delivery.at)}`, delivery.hookName, delivery.event, m(`st.${delivery.status}`), delivery.httpStatus === null ? '' : String(delivery.httpStatus), String(delivery.attempts)]);

  const notices: ReactNode[] = view.unknownHook ? [<RecordNotice key="hook" param="hook" message={m('notice.hook')} />] : [];
  const noMatch = <NoMatch title={m('none')} clearParams={['q', 'status']} />;

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      tabs={tabs}
      isEmpty={view.clients.length === 0}
      emptyAction={<CreateClientButton canEdit={canEdit} variant="secondary" showReason />}
      overlays={
        <>
          <ClientCreate open={query.client === 'new' && canEdit} canEdit={canEdit} />
          <HookDrawer key={view.openHook === undefined ? 'none' : view.openHook === 'new' ? 'new' : view.openHook.id} hook={view.openHook} canEdit={canEdit} />
        </>
      }
      actions={<ApiHeader canEdit={canEdit} exportRows={exportRows} exportHeader={exportHeader} exportFilename={exportFilename} />}
    >
      <div className={styles.stack}>
        {notices}
        <StatStrip
          items={[
            { label: m('stat.clients'), value: view.counts.activeClients },
            { label: m('tab.hooks'), value: view.counts.hooks },
            { label: m('stat.failed'), value: view.counts.failed },
          ]}
        />
        {tab === 'clients' ? (
          <TabPanel id="aw" value="clients">
            <Card padding="none">
              <CardHeader title={m('tab.clients')} />
              <AdminTable caption={m('tab.clients')} columns={clientColumns} rows={view.clients.map((client) => clientTableRow(client, m, canEdit, locale))} rowParam={false} pageSize={0} />
            </Card>
          </TabPanel>
        ) : null}
        {tab === 'hooks' ? (
          <TabPanel id="aw" value="hooks">
            <Card padding="none">
              <CardHeader
                title={m('tab.hooks')}
                actions={
                  <span className={styles.inline}>
                    <StubTag kind="demo" />
                    <AddHookButton canEdit={canEdit} />
                  </span>
                }
              />
              <AdminTable caption={m('tab.hooks')} columns={hookColumns} rows={view.hooks.map((hook) => hookTableRow(hook, m, canEdit, locale))} rowParam="hook" pageSize={0} emptyState={<NoMatch title={m('none')} clearParams={[]} />} />
            </Card>
          </TabPanel>
        ) : null}
        {tab === 'log' ? (
          <TabPanel id="aw" value="log">
            <Card padding="none">
              <CardHeader title={m('tab.log')} actions={<StubTag kind="demo" />} />
              <ListToolbar searchLabel={m('log.search')} filters={[{ key: 'status', label: t('common.status'), options: [{ value: 'succeeded', label: m('st.succeeded') }, { value: 'failed', label: m('st.failed') }] }]} />
              <AdminTable caption={m('tab.log')} columns={logColumns} rows={view.shownDeliveries.map((delivery) => deliveryTableRow(delivery, m, canEdit, locale))} rowParam={false} page={query.page} emptyState={noMatch} />
            </Card>
          </TabPanel>
        ) : null}
        {tab === 'limits' ? (
          <TabPanel id="aw" value="limits">
            <div className={styles.detailGrid}>
              <LimitsPanel limits={view.limits} canEdit={canEdit} />
              <aside className={styles.col}>
                <Card padding="lg">
                  <div className={styles.stack}>
                    <div className={styles.headRow}>
                      <h2 className={styles.sectionTitle}>{m('retry.title')}</h2>
                      <span className={styles.inline}>
                        <IllustrativeLabel />
                        <StubTag kind="notApplied" />
                      </span>
                    </div>
                    <DescriptionList
                      dense
                      columns={1}
                      items={[
                        { label: m('col.attempts'), value: <bdi translate="no">3</bdi> },
                        {
                          label: m('retry.wait'),
                          value: (
                            <>
                              <bdi translate="no">1, 5, 15</bdi> {t('common.minShort')}
                            </>
                          ),
                        },
                        {
                          label: m('retry.signing'),
                          value: (
                            <Badge tone="success" size="sm">
                              {t('common.on')}
                            </Badge>
                          ),
                        },
                      ]}
                    />
                  </div>
                </Card>
              </aside>
            </div>
          </TabPanel>
        ) : null}
      </div>
    </ScreenFrame>
  );
}

function stamp(iso: string, locale: 'en' | 'ar'): ReactNode {
  return (
    <span translate="no">
      <span className={styles.cellMain}>{date(iso, { locale })}</span>
      <span className={styles.cellSub}>{time(iso)}</span>
    </span>
  );
}

function clientTableRow(client: ClientRow, m: Translate, canEdit: boolean, locale: 'en' | 'ar'): AdminTableRow {
  return {
    id: client.id,
    label: client.name,
    tone: client.revoked ? 'neutral' : undefined,
    cells: {
      client: (
        <span>
          <span className={styles.cellMain} translate="no">
            {client.name}
          </span>
          <span className={styles.cellSub}>{m('created', { date: date(client.createdAt, { locale }) })}</span>
        </span>
      ),
      scopes: (
        <span className={styles.tags}>
          {client.scopes.map((scope) => (
            <ScopeTag key={scope} scope={scope} />
          ))}
        </span>
      ),
      key: <span translate="no">····{client.hint}</span>,
      used: client.lastUsedAt === null ? <span className={styles.muted}>{m('never')}</span> : stamp(client.lastUsedAt, locale),
      status: <StatusPill status={m(client.revoked ? 'st.revoked' : 'st.active')} tone={client.revoked ? 'neutral' : 'success'} size="sm" />,
      actions: client.revoked ? null : (
        <span className={styles.rowActions}>
          <RotateButton clientId={client.id} canEdit={canEdit} />
          <RevokeButton clientId={client.id} name={client.name} canEdit={canEdit} />
        </span>
      ),
    },
  };
}

function hookTableRow(hook: HookRow, m: Translate, canEdit: boolean, locale: 'en' | 'ar'): AdminTableRow {
  return {
    id: hook.id,
    label: hook.name,
    cells: {
      hook: (
        <span>
          <span className={styles.cellMain} translate="no">
            {hook.name}
          </span>
          <span className={styles.cellSub} translate="no">
            {hook.url}
          </span>
        </span>
      ),
      events: (
        <span className={styles.tags}>
          {hook.events.map((event) => (
            <span key={event} translate="no">
              <Badge size="sm" tone="neutral">
                {event}
              </Badge>
            </span>
          ))}
        </span>
      ),
      last: (
        <span>
          {hook.lastDeliveryAt === null ? <span className={styles.muted}>{m('never')}</span> : stamp(hook.lastDeliveryAt, locale)}
          {hook.lastStatus === null ? null : <span className={styles.cellSub}>{m(`st.${hook.lastStatus}`)}</span>}
        </span>
      ),
      status: <StatusPill status={m(hook.enabled ? 'st.on' : 'st.off')} tone={hook.enabled ? 'success' : 'neutral'} size="sm" />,
      actions: (
        <span className={styles.rowActions}>
          <TestHookButton hookId={hook.id} canEdit={canEdit} />
        </span>
      ),
    },
  };
}

function deliveryTableRow(delivery: DeliveryRow, m: Translate, canEdit: boolean, locale: 'en' | 'ar'): AdminTableRow {
  const failed = delivery.status === 'failed';
  return {
    id: delivery.id,
    label: `${delivery.hookName} ${delivery.event}`,
    tone: failed ? 'danger' : undefined,
    cells: {
      time: stamp(delivery.at, locale),
      hook: <span translate="no">{delivery.hookName}</span>,
      event: (
        <span translate="no">
          <Badge size="sm" tone="neutral">
            {delivery.event}
          </Badge>
        </span>
      ),
      status: (
        <span>
          <StatusPill status={m(`st.${delivery.status}`)} tone={failed ? 'danger' : delivery.status === 'pending' ? 'info' : 'success'} size="sm" />
          {delivery.httpStatus === null ? null : (
            <span className={styles.cellSub} translate="no">
              HTTP {delivery.httpStatus}
            </span>
          )}
        </span>
      ),
      attempts: <span translate="no">{delivery.attempts}</span>,
      actions: failed ? <RetryButton deliveryId={delivery.id} canEdit={canEdit} /> : null,
    },
  };
}
