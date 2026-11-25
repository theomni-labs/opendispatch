// SPDX-License-Identifier: AGPL-3.0-only
import { Card, CardHeader } from '@opendispatch/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { ImportButton, ImportDialog, LocationDrawer, LocationsHeader } from './LocationsForms';
import { LocationMap, StandbyTable, SubZonesTable, ZonesTree } from './LocationsTables';
import styles from './Locations.module.css';
import { LOCATION_KINDS, type EditTarget, type LocationKind } from './types';
import { loadLocationsView } from './view';

// Locations. A Server Component: it reads through lib/data with the request context ModuleRoute built,
// and passes plain data to the client files (tables, map, forms). Tab, search, zone filter, sort, page, the open record and the
// import dialog live in the address (?tab= ?q= ?zone= ?city= ?sort= ?page= ?edit=<kind>:<id|new> ?ar=1 ?import=1); each is
// checked here against an allow-list. A role with no access never reaches this screen (ModuleRoute shows the no-access page
// first); a view-only role sees every control disabled with the reason. `?state=empty|loading|error` (demo-mode review hook)
// shows those states without reading data.

const TABS = ['zones', 'subs', 'standby'] as const;
const EXPORT_FILE = 'locations.csv';
const EDIT = /^(city|zone|sub_zone|standby):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|new)$/i;
/** A zone code (`RD-C`) as the address carries it. The view checks that a zone has it. */
const ZONE_CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;

/** `?edit=zone:<id>` as a target; the pattern was checked by parseSearchParams. */
function targetOf(value: string | undefined): EditTarget | undefined {
  const match = value === undefined ? null : EDIT.exec(value);
  if (match === null) return undefined;
  const kind = match[1] as LocationKind;
  const id = (match[2] as string).toLowerCase();
  return (LOCATION_KINDS as readonly string[]).includes(kind) ? { kind, id: id === 'new' ? 'new' : id } : undefined;
}

export async function LocationsScreen({ def, ctx, access, homeHref, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.locations');
  const t = await getTranslations();
  const canEdit = access.access === 'edit';

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        actions={<LocationsHeader canEdit={canEdit} exportFilename={EXPORT_FILE} exportHeader={[]} exportRows={undefined} />}
        emptyAction={<ImportButton canEdit={canEdit} variant="secondary" />}
      />
    );
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    q: param.text(80),
    zone: param.pattern(ZONE_CODE, 32),
    city: param.pattern(/^[A-Z]{2}$/, 2),
    sort: param.sort(['name', 'zone', 'code', 'radius']),
    edit: param.pattern(EDIT, 60),
    ar: param.flag(),
    import: param.flag(),
    page: param.int(1, 1000),
  });
  const target = targetOf(query.edit);
  const importOpen = query.import === true && canEdit;
  const view = await loadLocationsView(ctx, { q: query.q, zone: query.zone, edit: target }, canEdit, importOpen);
  const tab = query.tab ?? 'zones';
  const selectedZone = view.zones.find((zone) => zone.code === query.zone)?.code;
  const isEmpty = view.totals.cities === 0 && view.totals.zones === 0 && view.totals.subZones === 0 && view.totals.standbyPoints === 0;

  const tabs = (
    <UrlTabs
      id="lo"
      ariaLabel={m('tabs.label')}
      defaultTab="zones"
      resetParams={['q', 'sort', 'edit', 'ar']}
      tabs={[
        { value: 'zones', label: m('tab.zones') },
        { value: 'subs', label: m('tab.subs') },
        { value: 'standby', label: m('tab.standby') },
      ]}
    />
  );

  const zoneFilter = { key: 'zone', label: t('common.zone'), options: view.zoneOptions.map((zone) => ({ value: zone.code, label: zone.code })) };
  const noMatch = <NoMatch title={m('nomatch')} clearParams={['q', 'zone']} />;

  let table: ReactNode;
  if (tab === 'zones') {
    table = (
      <Card padding="none">
        <CardHeader title={m('tree.title')} actions={<ImportButton canEdit={canEdit} />} />
        <TabPanel id="lo" value="zones">
          <ZonesTree cities={view.cities} zones={view.zones} selectedZone={selectedZone} canEdit={canEdit} caption={m('tree.title')} />
        </TabPanel>
      </Card>
    );
  } else {
    const isSubs = tab === 'subs';
    table = (
      <Card padding="none">
        <ListToolbar searchLabel={m('search')} filters={[zoneFilter]} actions={<ImportButton canEdit={canEdit} />} />
        <TabPanel id="lo" value={tab}>
          {isSubs ? (
            <SubZonesTable rows={view.subZones} caption={m('tab.subs')} canEdit={canEdit} emptyState={noMatch} sort={query.sort} page={query.page} />
          ) : (
            <StandbyTable rows={view.standby} caption={m('tab.standby')} canEdit={canEdit} emptyState={noMatch} sort={query.sort} page={query.page} />
          )}
        </TabPanel>
        <div className={styles.summary}>{m('showing', { n: isSubs ? view.subZones.length : view.standby.length, total: isSubs ? view.totals.subZones : view.totals.standbyPoints })}</div>
      </Card>
    );
  }

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      isEmpty={isEmpty}
      emptyAction={<ImportButton canEdit={canEdit} variant="secondary" />}
      overlays={
        <>
          <LocationDrawer target={target} record={view.open} canEdit={canEdit} cities={view.cities} zones={view.zoneOptions} subZones={view.subZoneOptions} focusArabic={query.ar === true} />
          <ImportDialog open={importOpen} canEdit={canEdit} sample={view.sample} />
        </>
      }
      tabs={tabs}
      actions={<LocationsHeader canEdit={canEdit} exportFilename={EXPORT_FILE} exportHeader={view.exportHeader} exportRows={view.exportRows} />}
    >
      <div className={styles.stack}>
        {view.unknownEdit ? <RecordNotice param="edit" message={m('notice.notFound')} /> : null}
        <StatStrip
          items={[
            { label: m('st.cities'), value: view.totals.cities },
            { label: m('tab.zones'), value: view.totals.zones },
            { label: m('tab.subs'), value: view.totals.subZones },
            { label: m('tab.standby'), value: view.totals.standbyPoints },
          ]}
        />
        <div className={styles.grid}>
          <div className={styles.col}>{table}</div>
          <aside className={styles.col}>
            <LocationMap cities={view.cities} zones={view.zones} standby={view.mapStandby} initialCity={query.city} selectedZone={selectedZone} />
          </aside>
        </div>
      </div>
    </ScreenFrame>
  );
}
