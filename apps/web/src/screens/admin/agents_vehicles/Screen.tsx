// SPDX-License-Identifier: AGPL-3.0-only
import { Card } from '@opendispatch/ui';
import { getTranslations } from 'next-intl/server';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { AddButton, ImportDialog, SkillDialog, AgentDrawer, AgentsHeader, VehicleDrawer } from './AgentsForms';
import { SkillsPanel, AgentsTable, VehiclesTable } from './AgentsTables';
import styles from './AgentsVehicles.module.css';
import { LEAVE_STATUSES, REMOTE_POOL } from './types';
import { loadAgentsView } from './view';

// Agents and Vehicles. A Server Component: it reads through lib/data with the request context ModuleRoute
// built, and passes plain data to the client files. Tab, search, zone, shift and leave filters, sort, page, the open agent or
// vehicle, the skill dialog and the import dialog live in the address (?tab= ?q= ?zone= ?shift= ?leave= ?sort= ?page= ?agent=
// ?vehicle= ?skill=new ?import=1); each is checked here against an allow-list. A role with no access never reaches this screen;
// a view-only role sees every control disabled with the reason. `?state=empty|loading|error` shows those states without reading data.

const TABS = ['agents', 'vehicles', 'skills'] as const;
const EXPORT_FILE = 'agents.csv';
const RECORD = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|new)$/i;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;

export async function AgentsVehiclesScreen({ def, ctx, access, homeHref, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.agents_vehicles');
  const t = await getTranslations();
  const canEdit = access.access === 'edit';

  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        actions={<AgentsHeader canEdit={canEdit} exportFilename={EXPORT_FILE} exportHeader={[]} exportRows={undefined} />}
        emptyAction={<AddButton canEdit={canEdit} tab="agents" variant="secondary" />}
      />
    );
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    q: param.text(80),
    zone: param.pattern(CODE, 32),
    shift: param.pattern(CODE, 32),
    leave: param.enum(LEAVE_STATUSES),
    sort: param.sort(['name', 'zone', 'vehicle']),
    agent: param.pattern(RECORD, 40),
    vehicle: param.pattern(RECORD, 40),
    skill: param.pattern(/^new$/, 3),
    import: param.flag(),
    page: param.int(1, 1000),
  });
  const tab = query.tab ?? 'agents';
  const importOpen = query.import === true && canEdit;
  const view = await loadAgentsView(ctx, { q: query.q, zone: query.zone, shift: query.shift, leave: query.leave, agent: query.agent?.toLowerCase(), vehicle: query.vehicle?.toLowerCase() }, canEdit, importOpen);
  const skillNames = Object.fromEntries(view.skills.map((s) => [s.code, s.nameEn]));

  const zoneOptions = [...view.zones.map((z) => ({ value: z.code, label: z.code })), ...(tab === 'agents' ? [{ value: REMOTE_POOL, label: t('scopes.remote_pool') }] : [])];
  const noMatch = <NoMatch title={m(tab === 'vehicles' ? 'nomatchVehicles' : 'nomatch')} clearParams={['q', 'zone', 'shift', 'leave']} />;
  const tabs = (
    <UrlTabs
      id="sv"
      ariaLabel={m('tabs.label')}
      defaultTab="agents"
      resetParams={['q', 'sort', 'agent', 'vehicle', 'skill', 'zone', 'shift', 'leave']}
      tabs={[
        { value: 'agents', label: m('tab.agents'), count: view.totals.agents },
        { value: 'vehicles', label: m('tab.vehicles'), count: view.totals.vehicles },
        { value: 'skills', label: m('tab.skills'), count: view.totals.skills },
      ]}
    />
  );

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      isEmpty={view.totals.agents === 0 && view.totals.vehicles === 0}
      emptyAction={<AddButton canEdit={canEdit} tab="agents" variant="secondary" />}
      overlays={
        <>
          <AgentDrawer agent={view.openAgent} isNew={query.agent?.toLowerCase() === 'new' && canEdit} canEdit={canEdit} zones={view.zones} shifts={view.shifts} vehicles={view.allVehicles} standby={view.standby} skills={view.skills} />
          <VehicleDrawer vehicle={view.openVehicle} isNew={query.vehicle?.toLowerCase() === 'new' && canEdit} canEdit={canEdit} zones={view.zones} maintenance={view.maintenance} />
          <SkillDialog open={query.skill === 'new' && canEdit} canEdit={canEdit} />
          <ImportDialog open={importOpen} canEdit={canEdit} sample={view.sample} />
        </>
      }
      tabs={tabs}
      actions={<AgentsHeader canEdit={canEdit} exportFilename={EXPORT_FILE} exportHeader={view.exportHeader} exportRows={view.exportRows} />}
    >
      <div className={styles.stack}>
        {view.unknownRecord ? <RecordNotice param={query.agent === undefined ? 'vehicle' : 'agent'} message={m('notice.notFound')} /> : null}
        {tab === 'agents' ? (
          <StatStrip
            items={[
              { label: m('tab.agents'), value: view.totals.agents },
              { label: m('handling.field'), value: view.totals.field, hint: m('inferred') },
              { label: t('scopes.remote_pool'), value: view.totals.remote, hint: m('inferred') },
              { label: m('tab.vehicles'), value: view.totals.vehicles },
            ]}
          />
        ) : null}
        <TabPanel id="sv" value={tab}>
          {tab === 'skills' ? (
            <SkillsPanel skills={view.skills} canEdit={canEdit} />
          ) : (
            <Card padding="none">
              <ListToolbar
                searchLabel={m(tab === 'vehicles' ? 'q-v' : 'q-s')}
                filters={[
                  { key: 'zone', label: t('common.zone'), options: zoneOptions },
                  ...(tab === 'agents'
                    ? [
                        { key: 'shift', label: m('f.shift'), options: view.shifts.map((s) => ({ value: s.code, label: s.name })) },
                        { key: 'leave', label: m('col.leave'), options: LEAVE_STATUSES.map((status) => ({ value: status, label: m(`leave.${status}`) })) },
                      ]
                    : []),
                ]}
              />
              {tab === 'agents' ? (
                <AgentsTable
                  rows={view.agents}
                  skillNames={skillNames}
                  caption={m('tab.agents')}
                  canEdit={canEdit}
                  emptyState={noMatch}
                  exportHeader={view.exportHeader}
                  exportRows={view.exportRows}
                  exportFilename={EXPORT_FILE}
                  sort={query.sort}
                  page={query.page}
                />
              ) : (
                <VehiclesTable rows={view.vehicles} caption={m('tab.vehicles')} emptyState={noMatch} sort={query.sort} page={query.page} maintenance={view.maintenance} />
              )}
              <div className={styles.summary}>{m('showing', { n: tab === 'agents' ? view.agents.length : view.vehicles.length, total: tab === 'agents' ? view.totals.agents : view.totals.vehicles })}</div>
            </Card>
          )}
        </TabPanel>
      </div>
    </ScreenFrame>
  );
}
