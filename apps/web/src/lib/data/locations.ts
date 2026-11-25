// SPDX-License-Identifier: AGPL-3.0-only
// Cities, zones, sub-zones, standby points.

import type { City, CityList, LocationImportResult, StandbyPoint, StandbyPointList, SubZone, SubZoneList, Zone, ZoneList } from '@/lib/types';
import { requireFound, requirePlatform, type PageQuery } from './context';
import { requireAccess, type RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { sampleText } from './internal/samples';
import { pathSegment } from './internal/path-segment';

// ---------------------------------------------------------------------------------------------
// Access control, validation, audit: Go's job now.
// ---------------------------------------------------------------------------------------------

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: listCities
export async function listCities(ctx: RequestContext, query: PageQuery & { readonly q?: string | undefined } = {}): Promise<CityList> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<CityList>(ctx, `/cities${qs({ limit: query.limit, cursor: query.cursor, q: query.q })}`))!;
}

// operationId: getCity
export async function getCity(ctx: RequestContext, id: string): Promise<City> {
  requirePlatform(ctx, 'platform.records');
  return requireFound(await businessFetch<City>(ctx, `/cities/${pathSegment(id)}`), 'City');
}

// operationId: listZones
export async function listZones(ctx: RequestContext, query: PageQuery & { readonly city_id?: string | undefined; readonly q?: string | undefined } = {}): Promise<ZoneList> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<ZoneList>(ctx, `/zones${qs({ limit: query.limit, cursor: query.cursor, city_id: query.city_id, q: query.q })}`))!;
}

// operationId: getZone
export async function getZone(ctx: RequestContext, id: string): Promise<Zone> {
  requirePlatform(ctx, 'platform.records');
  return requireFound(await businessFetch<Zone>(ctx, `/zones/${pathSegment(id)}`), 'Zone');
}

// operationId: listSubZones
export async function listSubZones(ctx: RequestContext, query: PageQuery & { readonly zone_id?: string | undefined; readonly q?: string | undefined } = {}): Promise<SubZoneList> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<SubZoneList>(ctx, `/sub-zones${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, q: query.q })}`))!;
}

// operationId: getSubZone
export async function getSubZone(ctx: RequestContext, id: string): Promise<SubZone> {
  requirePlatform(ctx, 'platform.records');
  return requireFound(await businessFetch<SubZone>(ctx, `/sub-zones/${pathSegment(id)}`), 'Sub-zone');
}

// operationId: listStandbyPoints
export async function listStandbyPoints(ctx: RequestContext, query: PageQuery & { readonly zone_id?: string | undefined } = {}): Promise<StandbyPointList> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<StandbyPointList>(ctx, `/standby-points${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id })}`))!;
}

// operationId: createCity
export async function createCity(ctx: RequestContext, body: unknown): Promise<City> {
  return (await businessFetch<City>(ctx, '/cities', { method: 'POST', body }))!;
}

// operationId: updateCity
export async function updateCity(ctx: RequestContext, id: string, body: unknown): Promise<City> {
  return (await businessFetch<City>(ctx, `/cities/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: createZone
export async function createZone(ctx: RequestContext, body: unknown): Promise<Zone> {
  return (await businessFetch<Zone>(ctx, '/zones', { method: 'POST', body }))!;
}

// operationId: updateZone
export async function updateZone(ctx: RequestContext, id: string, body: unknown): Promise<Zone> {
  return (await businessFetch<Zone>(ctx, `/zones/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: createSubZone
export async function createSubZone(ctx: RequestContext, body: unknown): Promise<SubZone> {
  return (await businessFetch<SubZone>(ctx, '/sub-zones', { method: 'POST', body }))!;
}

// operationId: updateSubZone
export async function updateSubZone(ctx: RequestContext, id: string, body: unknown): Promise<SubZone> {
  return (await businessFetch<SubZone>(ctx, `/sub-zones/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: createStandbyPoint
export async function createStandbyPoint(ctx: RequestContext, body: unknown): Promise<StandbyPoint> {
  return (await businessFetch<StandbyPoint>(ctx, '/standby-points', { method: 'POST', body }))!;
}

// operationId: updateStandbyPoint
export async function updateStandbyPoint(ctx: RequestContext, id: string, body: unknown): Promise<StandbyPoint> {
  return (await businessFetch<StandbyPoint>(ctx, `/standby-points/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: deleteStandbyPoint
export async function deleteStandbyPoint(ctx: RequestContext, id: string): Promise<void> {
  await businessFetch<void>(ctx, `/standby-points/${pathSegment(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------------------------
// Import from a CSV file (DG11): one audited call, every row validated first, all or nothing
// ---------------------------------------------------------------------------------------------

export interface ImportSample {
  readonly file_name: string;
  readonly content_type: 'text/csv';
  readonly text: string;
}

/** The sample file of the import dialog ("Use a sample file"): invented, synthetic locations that import into a fresh demo. */
// operationId: (not in the contract) getLocationsImportSample
export function getLocationsImportSample(ctx: RequestContext): ImportSample {
  requireAccess(ctx, 'admin.locations', 'view');
  return { file_name: 'locations_sample.csv', content_type: 'text/csv', text: sampleText('locations_sample.csv') };
}

/**
 * Imports cities, zones, sub-zones and standby points from a CSV file (DG11). The client sends the file text. The whole file is
 * checked first and nothing is written unless every row is valid. Rows only add records. One audited event holds the counts (never
 * the file). Every record is SYNTHETIC in demo mode.
 */
// operationId: importLocations
export async function importLocations(ctx: RequestContext, body: unknown): Promise<LocationImportResult> {
  return (await businessFetch<LocationImportResult>(ctx, '/locations/import', { method: 'POST', body }))!;
}
