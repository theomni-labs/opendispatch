// SPDX-License-Identifier: AGPL-3.0-only
import { Card, StatusPill, Tag, type Tone } from '@opendispatch/ui';
import { date, time } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { AdminTableColumn, AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import { ROLES } from '@/lib/access';
import type { ScreenProps } from '@/screens/types';
import { InviteButton, InviteDrawer, UserDrawer, UsersHeader, ZoneTags } from './UsersForms';
import { RolesTab, UsersTable } from './UsersTables';
import styles from './UsersRoles.module.css';
import type { UserRow, UserStatus } from './types';
import { loadUsersView } from './view';

// Users and Roles. A Server Component: it reads through lib/data with the request context ModuleRoute
// built, and passes plain data to the client files (tables, forms, drawers). Tab, search, filters, page and the open person
// live in the address (?tab= ?q= ?role= ?status= ?zone= ?page= ?id= ?new=1); each is checked here against an allow-list.
// A role with no access never reaches this screen (ModuleRoute shows the no-access page first); a view-only role sees every
// control disabled with the reason. `?state=empty|loading|error` (demo-mode review hook) shows those states without reading data.

const STATUSES = ['active', 'invited', 'disabled'] as const;
const TONES: Readonly<Record<UserStatus, Tone>> = { active: 'success', invited: 'info', disabled: 'neutral' };
const EXPORT_FILE = 'users.csv';

const first = (value: string | readonly string[] | undefined): string | undefined => (typeof value === 'string' ? value : value?.[0]);

export async function UsersRolesScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.users_roles');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';
  const subtitle = m('sub', { mode: t(`installModes.${ctx.installMode}`) });
  const exportHeader = [m('col.name'), m('col.email'), m('col.role'), m('col.scope'), t('common.status'), m('col.last')];

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        description={subtitle}
        actions={<UsersHeader canEdit={canEdit} hasEmergencyAdmin exportFilename={EXPORT_FILE} exportHeader={exportHeader} exportRows={undefined} />}
        emptyAction={<InviteButton canEdit={canEdit} variant="secondary" showReason />}
      />
    );
  }

  // Everything the address may ask for is validated here; the zone filter is checked against the zones read below.
  const query = parseSearchParams(searchParams, {
    tab: param.enum(['users', 'roles']),
    q: param.text(80),
    role: param.enum(ROLES),
    status: param.enum(STATUSES),
    zone: param.pattern(/^[A-Za-z0-9-]{1,16}$/, 16),
    id: param.id(),
    new: param.flag(),
    page: param.int(1, 1000),
  });
  const view = await loadUsersView(ctx, { q: query.q, role: query.role, status: query.status, zone: query.zone, id: query.id }, first(searchParams['id']));

  const rowsText = view.rows.map((row) => exportCells(row, m, t, locale));
  const rows = view.rows.map((row) => tableRow(row, m, t, locale));
  const columns: AdminTableColumn[] = [
    { key: 'name', header: m('col.name') },
    { key: 'email', header: m('col.email'), hideBelow: 'md' },
    { key: 'role', header: m('col.role') },
    { key: 'scope', header: m('col.scope'), hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
    { key: 'last', header: m('col.last'), hideBelow: 'lg' },
  ];

  const tab = query.tab ?? 'users';
  const availableRoles = view.roleOptions.filter((option) => option.availableHere);
  const tabs = (
    <UrlTabs
      id="ur"
      ariaLabel={m('tabs.label')}
      defaultTab="users"
      tabs={[
        { value: 'users', label: m('tab.users'), count: view.total },
        { value: 'roles', label: m('tab.roles'), count: availableRoles.length },
      ]}
    />
  );

  const usersTab: ReactNode = (
    <TabPanel id="ur" value="users">
      <div className={styles.stack}>
        <StatStrip
          items={[
            { label: m('st.total'), value: view.total },
            { label: m('status.active'), value: view.counts.active },
            { label: m('status.invited'), value: view.counts.invited },
            { label: m('status.disabled'), value: view.counts.disabled },
          ]}
        />
        <Card padding="none">
          <ListToolbar
            searchLabel={m('search')}
            filters={[
              { key: 'role', label: m('f.role'), options: availableRoles.map((option) => ({ value: option.role, label: t(`roles.${option.role}`) })) },
              { key: 'status', label: t('common.status'), options: STATUSES.map((status) => ({ value: status, label: m(`status.${status}`) })) },
              { key: 'zone', label: t('common.zone'), options: view.zones.map((zone) => ({ value: zone.code, label: zone.code })) },
            ]}
          />
          <UsersTable
            caption={m('table.caption')}
            columns={columns}
            rows={rows}
            people={view.rows.map((row, index) => ({ id: row.id, status: row.status, exportCells: rowsText[index] ?? [] }))}
            page={query.page}
            canEdit={canEdit}
            exportHeader={exportHeader}
            exportFilename={EXPORT_FILE}
            emptyState={<NoMatch title={m('nomatch')} clearParams={['q', 'role', 'status', 'zone']} />}
          />
          <div className={styles.summary}>{m('showing', { n: view.rows.length, total: view.total })}</div>
        </Card>
      </div>
    </TabPanel>
  );

  const rolesTab: ReactNode = (
    <TabPanel id="ur" value="roles">
      <RolesTab defaultMode={view.installMode} matrices={view.matrices} roleOptions={view.roleOptions} roleCounts={view.roleCounts} />
    </TabPanel>
  );

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      description={subtitle}
      sources={view.sources}
      isEmpty={view.total === 0}
      emptyAction={<InviteButton canEdit={canEdit} variant="secondary" showReason />}
      overlays={
        <>
          <UserDrawer user={view.open?.user} access={view.open?.access} canEdit={canEdit} roleOptions={view.roleOptions} zones={view.zones} installMode={view.installMode} hasEmergencyAdmin={view.hasEmergencyAdmin} />
          <InviteDrawer open={query.new === true && canEdit} canEdit={canEdit} roleOptions={view.roleOptions} zones={view.zones} matrices={view.matrices} installMode={view.installMode} />
        </>
      }
      tabs={tabs}
      actions={<UsersHeader canEdit={canEdit} hasEmergencyAdmin={view.hasEmergencyAdmin} exportFilename={EXPORT_FILE} exportHeader={exportHeader} exportRows={rowsText} />}
    >
      <div className={styles.stack}>
        {view.unknownId ? <RecordNotice message={m('notice.notFound')} /> : null}
        {tab === 'roles' ? rolesTab : usersTab}
      </div>
    </ScreenFrame>
  );
}

type Translate = Awaited<ReturnType<typeof getTranslations>>;

function scopeCell(row: UserRow, t: Translate): ReactNode {
  return row.scope === 'assigned_zones' ? <ZoneTags codes={row.zoneCodes} /> : t(`scopes.${row.scope}`);
}

function lastCell(row: UserRow, m: Translate, locale: 'en' | 'ar'): ReactNode {
  if (row.lastSignIn === null) return m('never');
  return (
    <>
      {date(row.lastSignIn, { locale })} <bdi dir="ltr">{time(row.lastSignIn)}</bdi>
    </>
  );
}

function tableRow(row: UserRow, m: Translate, t: Translate, locale: 'en' | 'ar'): AdminTableRow {
  return {
    id: row.id,
    label: row.name,
    cells: {
      name: (
        <span className={styles.cellMain}>
          <span translate="no">{row.name}</span>
          {row.emergency ? <Tag color="red">{m('emergency')}</Tag> : null}
        </span>
      ),
      email: (
        <span className={styles.muted} translate="no">
          {row.email}
        </span>
      ),
      role: t(`roles.${row.assignedRole}`),
      scope: scopeCell(row, t),
      status: <StatusPill status={m(`status.${row.status}`)} tone={TONES[row.status]} size="sm" />,
      last: <span className={styles.muted}>{lastCell(row, m, locale)}</span>,
    },
  };
}

/** The same row as text, for the CSV. The role and status are in the reader's language; names and codes are data. */
function exportCells(row: UserRow, m: Translate, t: Translate, locale: 'en' | 'ar'): string[] {
  return [
    row.name,
    row.email,
    t(`roles.${row.assignedRole}`),
    row.scope === 'assigned_zones' ? row.zoneCodes.join(' ') : t(`scopes.${row.scope}`),
    m(`status.${row.status}`),
    row.lastSignIn === null ? m('never') : `${date(row.lastSignIn, { locale })} ${time(row.lastSignIn)}`,
  ];
}
