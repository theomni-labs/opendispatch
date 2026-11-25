// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Locations screen: reads through lib/data with the request context and returns plain data.
// Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads: listCities, listZones, listSubZones, listStandbyPoints (platform.records, zone scoped), getSettingsSnapshot (the stage
// of each zone, read only), listAgents (the count per zone), getLocationsImportSample (only when the import dialog is open).

import type { RequestContext } from '@/lib/data/guard';
import { getLocationsImportSample, listCities, listStandbyPoints, listSubZones, listZones } from '@/lib/data/locations';
import { listAgents } from '@/lib/data/people';
import { getSettingsSnapshot } from '@/lib/data/settings';
import type { City, DataSource, Extra, LiveStage, PageInfo, StandbyPoint, SubZone, Agent, Zone } from '@/lib/types';
import type { CityRow, EditTarget, LocationRecord, MapStandby, StandbyRow, SubZoneOption, SubZoneRow, ZoneOption, ZoneRow } from './types';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface LocationsQuery {
  readonly q?: string | undefined;
  /** A zone code such as RD-C: filters the sub-zone and standby lists and marks the zone on the map. */
  readonly zone?: string | undefined;
  /** `edit=<kind>:<id|new>`, split. */
  readonly edit?: EditTarget | undefined;
}

export interface ImportSampleFile {
  readonly fileName: string;
  readonly text: string;
}

export interface LocationsView {
  /** The data_source of every record shown. */
  readonly sources: readonly DataSource[];
  readonly totals: { readonly cities: number; readonly zones: number; readonly subZones: number; readonly standbyPoints: number };
  readonly cities: readonly CityRow[];
  readonly zones: readonly ZoneRow[];
  /** The sub-zones and standby points matching the search and the zone filter. */
  readonly subZones: readonly SubZoneRow[];
  readonly standby: readonly StandbyRow[];
  /** Every sub-zone, for the standby form's sub-zone choice. */
  readonly subZoneOptions: readonly SubZoneOption[];
  readonly zoneOptions: readonly ZoneOption[];
  /** The standby points of every zone, for the map's pins. */
  readonly mapStandby: readonly MapStandby[];
  /** The record `?edit=` opens; undefined when there is none, it is `new`, or it does not exist. */
  readonly open: LocationRecord | undefined;
  /** `?edit=` named a record that does not exist: the screen says so above the list. */
  readonly unknownEdit: boolean;
  /** Only when the import dialog is open: the sample file of "Use a sample file". */
  readonly sample: ImportSampleFile | undefined;
  /** Every record as CSV cells, in the import's own columns, so an export can be imported again. */
  readonly exportHeader: readonly string[];
  readonly exportRows: readonly (readonly string[])[];
}

const PAGE = 200;

async function listAll<T>(fetch: (cursor: string | undefined) => { items: T[]; page: PageInfo } | Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

const text = (extra: Extra | undefined, key: string): string | undefined => {
  const value = extra?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};
const number = (extra: Extra | undefined, key: string): number | null => {
  const value = extra?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** The short code of a zone or sub-zone (`RD-C`), which the fixtures and the import keep in `extra.code`. */
export const codeOf = (record: { readonly extra?: Extra | undefined; readonly name_en: string }): string => text(record.extra, 'code') ?? record.name_en;

/** Case-insensitive contains over what a person sees in a row: name, code, Arabic name. */
function matches(query: string | undefined, ...parts: readonly (string | null | undefined)[]): boolean {
  if (query === undefined || query.trim() === '') return true;
  return parts.join(' ').toLowerCase().includes(query.trim().toLowerCase());
}

export async function loadLocationsView(ctx: RequestContext, query: LocationsQuery, canEdit: boolean, importOpen: boolean): Promise<LocationsView> {
  const cities = await listAll((cursor) => listCities(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const zones = await listAll((cursor) => listZones(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const subZones = await listAll((cursor) => listSubZones(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const standby = await listAll((cursor) => listStandbyPoints(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const agents = await listAll((cursor) => listAgents(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const stages = new Map<string, LiveStage>((await getSettingsSnapshot(ctx)).live_assignment_stages.map((s) => [s.zone_id, s.stage]));

  const cityById = new Map<string, City>(cities.map((c) => [c.id, c]));
  const zoneById = new Map<string, Zone>(zones.map((z) => [z.id, z]));
  const subById = new Map<string, SubZone>(subZones.map((s) => [s.id, s]));
  const agentsByZone = new Map<string, number>();
  for (const s of agents as Agent[]) if (s.home_zone_id !== null) agentsByZone.set(s.home_zone_id, (agentsByZone.get(s.home_zone_id) ?? 0) + 1);
  const count = <T>(rows: readonly T[], zoneOf: (row: T) => string): Map<string, number> => {
    const out = new Map<string, number>();
    for (const row of rows) out.set(zoneOf(row), (out.get(zoneOf(row)) ?? 0) + 1);
    return out;
  };
  const subsByZone = count(subZones, (s) => s.zone_id);
  const standbyByZone = count(standby, (p) => p.zone_id);

  const cityRows: CityRow[] = cities.map((c) => ({ id: c.id, code: c.case_code, name: c.name_en, nameAr: c.name_ar, active: c.is_active, zoneIds: zones.filter((z) => z.city_id === c.id).map((z) => z.id) }));
  const zoneRows: ZoneRow[] = zones.map((z) => ({
    id: z.id,
    cityId: z.city_id,
    cityCode: cityById.get(z.city_id)?.case_code ?? '',
    code: codeOf(z),
    name: z.name_en,
    nameAr: z.name_ar,
    latitude: z.latitude ?? null,
    longitude: z.longitude ?? null,
    radiusKm: number(z.extra, 'radius_km'),
    active: z.is_active,
    stage: stages.get(z.id) ?? 'shadow',
    subZones: subsByZone.get(z.id) ?? 0,
    standbyPoints: standbyByZone.get(z.id) ?? 0,
    agents: agentsByZone.get(z.id) ?? 0,
  }));
  const zoneCode = (id: string): string => (zoneById.has(id) ? codeOf(zoneById.get(id) as Zone) : '');
  const allSubRows: SubZoneRow[] = subZones.map((s) => ({ id: s.id, zoneId: s.zone_id, zoneCode: zoneCode(s.zone_id), code: codeOf(s), name: s.name_en, nameAr: s.name_ar, latitude: s.latitude, longitude: s.longitude, active: s.is_active }));
  const allStandbyRows: StandbyRow[] = (standby as StandbyPoint[]).map((p) => ({
    id: p.id,
    zoneId: p.zone_id,
    zoneCode: zoneCode(p.zone_id),
    subZoneId: p.sub_zone_id ?? null,
    subZoneName: p.sub_zone_id === null || p.sub_zone_id === undefined ? null : (subById.get(p.sub_zone_id)?.name_en ?? null),
    code: text(p.extra, 'code') ?? p.name_en,
    name: p.name_en,
    nameAr: p.name_ar,
    latitude: p.latitude,
    longitude: p.longitude,
    radiusM: p.coverage_radius_m,
    active: p.is_active,
  }));

  // The zone filter is a code; a code that is not a zone filters nothing (the screen never trusts the address).
  const zoneFilter = query.zone === undefined ? undefined : zoneRows.find((z) => z.code === query.zone)?.id;
  const inZone = (zoneId: string): boolean => zoneFilter === undefined || zoneId === zoneFilter;
  const subRows = allSubRows.filter((s) => inZone(s.zoneId) && matches(query.q, s.name, s.code, s.nameAr));
  const standbyRows = allStandbyRows.filter((p) => inZone(p.zoneId) && matches(query.q, p.name, p.code, p.nameAr));

  const edit = query.edit;
  let open: LocationRecord | undefined;
  if (edit !== undefined && edit.id !== 'new') {
    if (edit.kind === 'city') {
      const c = cityById.get(edit.id);
      if (c !== undefined) open = { kind: 'city', id: c.id, code: c.case_code, name: c.name_en, nameAr: c.name_ar, active: c.is_active, parentId: null, latitude: null, longitude: null, radius: null, subZoneId: null, stage: null };
    } else if (edit.kind === 'zone') {
      const z = zoneRows.find((row) => row.id === edit.id);
      if (z !== undefined) open = { kind: 'zone', id: z.id, code: z.code, name: z.name, nameAr: z.nameAr, active: z.active, parentId: z.cityId, latitude: z.latitude, longitude: z.longitude, radius: z.radiusKm, subZoneId: null, stage: z.stage };
    } else if (edit.kind === 'sub_zone') {
      const s = allSubRows.find((row) => row.id === edit.id);
      if (s !== undefined) open = { kind: 'sub_zone', id: s.id, code: s.code, name: s.name, nameAr: s.nameAr, active: s.active, parentId: s.zoneId, latitude: s.latitude, longitude: s.longitude, radius: null, subZoneId: null, stage: null };
    } else {
      const p = allStandbyRows.find((row) => row.id === edit.id);
      if (p !== undefined) open = { kind: 'standby', id: p.id, code: p.code, name: p.name, nameAr: p.nameAr, active: p.active, parentId: p.zoneId, latitude: p.latitude, longitude: p.longitude, radius: p.radiusM, subZoneId: p.subZoneId, stage: null };
    }
  }

  const sample = importOpen && canEdit ? getLocationsImportSample(ctx) : undefined;
  const exportRows: string[][] = [
    ...cityRows.map((c) => ['city', c.code, '', c.name, c.nameAr ?? '', '', '', '', '']),
    ...zoneRows.map((z) => ['zone', z.code, z.cityCode, z.name, z.nameAr ?? '', z.latitude === null ? '' : String(z.latitude), z.longitude === null ? '' : String(z.longitude), '', '']),
    ...allSubRows.map((s) => ['sub_zone', s.code, s.zoneCode, s.name, s.nameAr ?? '', String(s.latitude), String(s.longitude), '', '']),
    ...allStandbyRows.map((p) => ['standby_point', p.code, p.zoneCode, p.name, p.nameAr ?? '', String(p.latitude), String(p.longitude), String(p.radiusM), p.subZoneId === null ? '' : (allSubRows.find((s) => s.id === p.subZoneId)?.code ?? '')]),
  ];

  return {
    sources: [...new Set<DataSource>([...cities, ...zones, ...subZones, ...standby].map((r) => r.data_source))],
    totals: { cities: cities.length, zones: zones.length, subZones: subZones.length, standbyPoints: standby.length },
    cities: cityRows,
    zones: zoneRows,
    subZones: subRows,
    standby: standbyRows,
    subZoneOptions: allSubRows.map((s) => ({ id: s.id, zoneId: s.zoneId, name: s.name })),
    zoneOptions: zoneRows.map((z) => ({ id: z.id, code: z.code, name: z.name, cityId: z.cityId })),
    mapStandby: allStandbyRows.map((p) => ({ id: p.id, zoneCode: p.zoneCode, name: p.name, latitude: p.latitude, longitude: p.longitude })),
    open,
    unknownEdit: edit !== undefined && edit.id !== 'new' && open === undefined,
    sample: sample === undefined ? undefined : { fileName: sample.file_name, text: sample.text },
    exportHeader: ['kind', 'code', 'parent_code', 'name_en', 'name_ar', 'latitude', 'longitude', 'coverage_radius_m', 'sub_zone_code'],
    exportRows,
  };
}
