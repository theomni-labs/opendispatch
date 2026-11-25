'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, CardHeader, IconButton, SegmentedControl, StatusPill, Tag, useFormat } from '@opendispatch/ui';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import type { SortParam } from '@/components/opendispatch/patterns/search-params';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { MapView, type MapPin, type MapSelection, type MapZone } from '@/components/opendispatch/MapView';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import type { CityRow, LocationKind, MapStandby, StandbyRow, SubZoneRow, ZoneRow } from './types';
import styles from './Locations.module.css';

// The tables and the map of the Locations screen (client files: the design system's DataTable takes functions, so the Server
// Component hands these plain data, and client-boundary.md). A row opens its drawer through the address
// (`?edit=<kind>:<id>`, a push, so Back closes it); "Add Arabic name" opens the same drawer with the Arabic field focused.
// Nothing here reads a context, a customer or the caller's role.

const editParam = (kind: LocationKind, id: string): string => `${kind}:${id}`;

function ActiveStatus({ active }: { active: boolean }) {
  const m = useTranslations('admin.locations');
  return <StatusPill status={m(active ? 'status.active' : 'status.inactive')} tone={active ? 'success' : 'neutral'} size="sm" />;
}

/**
 * The Arabic name, or the way to add one: the fixtures carry no Arabic names, so English is shown and the row says so
 * (the mockup's "Add Arabic name" and "English shown").
 */
function ArabicCell({ kind, id, nameAr, canEdit }: { kind: LocationKind; id: string; nameAr: string | null; canEdit: boolean }) {
  const m = useTranslations('admin.locations');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  if (nameAr !== null && nameAr !== '') {
    return (
      <span className={styles.arabic} lang="ar" dir="rtl">
        {nameAr}
      </span>
    );
  }
  return (
    <>
      <ReasonHint reason={gate.edit.reason} visible={false} quiet>
        <Button variant="link" size="sm" startIcon={<Plus />} onClick={() => gate.edit.allowed && url.update({ edit: editParam(kind, id), ar: '1' }, { history: 'push', keepPage: true })}>
          {m('ar.add')}
        </Button>
      </ReasonHint>
      <span className={styles.cellSub}>{m('ar.fallback')}</span>
    </>
  );
}

const Code = ({ children }: { children: string }) => <span translate="no">{children}</span>;

// ---------------------------------------------------------------------------------------------
// Cities and zones: a tree with counts
// ---------------------------------------------------------------------------------------------

export interface ZonesTreeProps {
  readonly cities: readonly CityRow[];
  readonly zones: readonly ZoneRow[];
  /** The zone the address selects (`?zone=`): its row is marked and the map outlines it. */
  readonly selectedZone: string | undefined;
  readonly canEdit: boolean;
  readonly caption: string;
}

export function ZonesTree({ cities, zones, selectedZone, canEdit, caption }: ZonesTreeProps) {
  const m = useTranslations('admin.locations');
  const t = useTranslations();
  const format = useFormat();
  const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>({});

  const columns: AdminTableColumn[] = [
    { key: 'name', header: m('col.name') },
    { key: 'ar', header: m('col.ar') },
    { key: 'subs', header: m('tab.subs'), align: 'end' },
    { key: 'standby', header: m('tab.standby'), align: 'end', hideBelow: 'md' },
    { key: 'agents', header: m('col.agents'), align: 'end', hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
  ];
  const num = (value: number) => <bdi translate="no">{format.int(value)}</bdi>;

  const rows: AdminTableRow[] = [];
  for (const city of cities) {
    const own = zones.filter((zone) => zone.cityId === city.id);
    const open = collapsed[city.id] !== true;
    rows.push({
      id: `city:${city.id}`,
      label: city.name,
      cells: {
        name: (
          <span className={styles.treeCell}>
            <span className={styles.flip}>
              <IconButton
                variant="ghost"
                size="sm"
                label={m('toggle')}
                aria-expanded={open}
                icon={open ? <ChevronDown /> : <ChevronRight />}
                onClick={() => setCollapsed((previous) => ({ ...previous, [city.id]: open }))}
              />
            </span>
            <span className={styles.cellMain} translate="no">
              {city.name}
            </span>
            <Tag color="geekblue">
              <Code>{city.code}</Code>
            </Tag>
          </span>
        ),
        ar: <ArabicCell kind="city" id={city.id} nameAr={city.nameAr} canEdit={canEdit} />,
        subs: num(own.reduce((sum, zone) => sum + zone.subZones, 0)),
        standby: num(own.reduce((sum, zone) => sum + zone.standbyPoints, 0)),
        agents: num(own.reduce((sum, zone) => sum + zone.agents, 0)),
        status: <ActiveStatus active={city.active} />,
      },
    });
    if (!open) continue;
    for (const zone of own) {
      rows.push({
        id: `zone:${zone.id}`,
        label: zone.name,
        tone: zone.code === selectedZone ? 'accent' : undefined,
        cells: {
          name: (
            <span className={`${styles.treeCell} ${styles.indent}`}>
              <Tag color="gray">
                <Code>{zone.code}</Code>
              </Tag>
              <span translate="no">{zone.name}</span>
            </span>
          ),
          ar: <ArabicCell kind="zone" id={zone.id} nameAr={zone.nameAr} canEdit={canEdit} />,
          subs: num(zone.subZones),
          standby: num(zone.standbyPoints),
          agents: num(zone.agents),
          status: <ActiveStatus active={zone.active} />,
        },
      });
    }
  }

  return <AdminTable caption={caption} columns={columns} rows={rows} rowParam="edit" pageSize={0} />;
}

// ---------------------------------------------------------------------------------------------
// Sub-zones and standby points
// ---------------------------------------------------------------------------------------------

export interface SubZonesTableProps {
  readonly rows: readonly SubZoneRow[];
  readonly caption: string;
  readonly canEdit: boolean;
  readonly emptyState: ReactNode;
  readonly sort?: SortParam | undefined;
  readonly page?: number | undefined;
}

export function SubZonesTable({ rows, caption, canEdit, emptyState, sort, page }: SubZonesTableProps) {
  const m = useTranslations('admin.locations');
  const t = useTranslations();
  const columns: AdminTableColumn[] = [
    { key: 'name', header: m('col.name'), sortable: true },
    { key: 'ar', header: m('col.ar') },
    { key: 'zone', header: t('common.zone'), sortable: true },
    { key: 'code', header: m('col.code'), hideBelow: 'md', sortable: true },
    { key: 'status', header: t('common.status') },
  ];
  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: editParam('sub_zone', row.id),
    label: row.name,
    sort: { name: row.name, zone: row.zoneCode, code: row.code },
    cells: {
      name: (
        <span className={styles.cellMain} translate="no">
          {row.name}
        </span>
      ),
      ar: <ArabicCell kind="sub_zone" id={row.id} nameAr={row.nameAr} canEdit={canEdit} />,
      zone: (
        <Tag color="gray">
          <Code>{row.zoneCode}</Code>
        </Tag>
      ),
      code: (
        <span className={styles.muted} translate="no">
          {row.code}
        </span>
      ),
      status: <ActiveStatus active={row.active} />,
    },
  }));
  return <AdminTable caption={caption} columns={columns} rows={tableRows} rowParam="edit" emptyState={emptyState} sort={sort} page={page} />;
}

export interface StandbyTableProps {
  readonly rows: readonly StandbyRow[];
  readonly caption: string;
  readonly canEdit: boolean;
  readonly emptyState: ReactNode;
  readonly sort?: SortParam | undefined;
  readonly page?: number | undefined;
}

export function StandbyTable({ rows, caption, canEdit, emptyState, sort, page }: StandbyTableProps) {
  const m = useTranslations('admin.locations');
  const t = useTranslations();
  const format = useFormat();
  const columns: AdminTableColumn[] = [
    { key: 'name', header: m('col.name'), sortable: true },
    { key: 'ar', header: m('col.ar') },
    { key: 'zone', header: t('common.zone'), sortable: true },
    { key: 'sub', header: m('col.sub'), hideBelow: 'md' },
    { key: 'radius', header: m('col.radius'), align: 'end', hideBelow: 'md', sortable: true },
    { key: 'status', header: t('common.status') },
  ];
  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: editParam('standby', row.id),
    label: row.name,
    sort: { name: row.name, zone: row.zoneCode, radius: row.radiusM },
    cells: {
      name: (
        <>
          <span className={styles.cellMain} translate="no">
            {row.name}
          </span>
          <span className={styles.cellSub} translate="no">
            {row.code}
          </span>
        </>
      ),
      ar: <ArabicCell kind="standby" id={row.id} nameAr={row.nameAr} canEdit={canEdit} />,
      zone: (
        <Tag color="gray">
          <Code>{row.zoneCode}</Code>
        </Tag>
      ),
      sub: row.subZoneName === null ? <span className={styles.muted}>-</span> : <span translate="no">{row.subZoneName}</span>,
      radius: <bdi translate="no">{format.int(row.radiusM)}</bdi>,
      status: <ActiveStatus active={row.active} />,
    },
  }));
  return <AdminTable caption={caption} columns={columns} rows={tableRows} rowParam="edit" emptyState={emptyState} sort={sort} page={page} />;
}

// ---------------------------------------------------------------------------------------------
// The map: zones by stage, standby points, one city at a time
// ---------------------------------------------------------------------------------------------

export interface LocationMapProps {
  readonly cities: readonly CityRow[];
  readonly zones: readonly ZoneRow[];
  readonly standby: readonly MapStandby[];
  /** The city the map opens on (`?city=`, checked on the server), or the first city. */
  readonly initialCity: string | undefined;
  readonly selectedZone: string | undefined;
}

const DEFAULT_RADIUS_KM = 5;

export function LocationMap({ cities, zones, standby, initialCity, selectedZone }: LocationMapProps) {
  const m = useTranslations('admin.locations');
  const url = useUrlState();
  const first = cities.find((city) => city.code === initialCity) ?? cities[0];
  const [cityCode, setCityCode] = useState(first?.code ?? '');
  const city = cities.find((c) => c.code === cityCode) ?? first;

  const mapZones: MapZone[] = zones
    .filter((zone) => zone.cityCode === city?.code && zone.latitude !== null && zone.longitude !== null)
    .map((zone) => ({ code: zone.code, lat: zone.latitude as number, lon: zone.longitude as number, radiusKm: zone.radiusKm ?? DEFAULT_RADIUS_KM, stage: zone.stage, active: zone.code === selectedZone }));
  const codes = new Set(mapZones.map((zone) => zone.code));
  const pins: MapPin[] = standby.filter((point) => codes.has(point.zoneCode)).map((point) => ({ id: point.id, lat: point.latitude, lon: point.longitude, kind: 'standby', label: point.name }));

  function onSelect(selection: MapSelection) {
    // A pin opens its standby point; a zone marks itself (the tables of the other tabs filter to it).
    if (selection.kind === 'pin') url.update({ edit: editParam('standby', selection.id), ar: null }, { history: 'push', keepPage: true });
    else url.update({ zone: selection.id === selectedZone ? null : selection.id });
  }

  return (
    <Card padding="none">
      <CardHeader
        title={m('map.title')}
        actions={
          cities.length > 1 ? (
            <SegmentedControl
              size="sm"
              ariaLabel={m('map.title')}
              value={city?.code ?? ''}
              options={cities.map((c) => ({ value: c.code, label: <span translate="no">{c.name}</span> }))}
              onChange={(next) => {
                setCityCode(next);
                url.update({ city: next }, { history: 'replace', keepPage: true });
              }}
            />
          ) : undefined
        }
      />
      <div className={styles.mapBody}>
        <MapView zones={mapZones} pins={pins} label={m('map.title')} legend={[{ dot: 'standby', label: m('map.standby') }]} height={380} onSelect={onSelect} />
      </div>
    </Card>
  );
}
