'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Locations screen: exactly the data functions of lib/data/locations.ts.
//
//   saveLocation        createCity / updateCity, createZone / updateZone, createSubZone / updateSubZone,
//                       createStandbyPoint / updateStandbyPoint   (one action, the kind says which)
//   deleteStandby       deleteStandbyPoint
//   importLocationsCsv  importLocations   (the browser reads the file and sends its text; all or nothing)
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. An update
// starts from the record as stored, because the data layer's bodies are complete: a body with no `external_id` or `extra`
// would blank them (The customer's IDs, the code, the zone radius). The screen sends only what a person typed.
// (tools/rules/context-rules.test.ts scans this file for the forbidden names.)

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import {
  createCity,
  createStandbyPoint,
  createSubZone,
  createZone,
  deleteStandbyPoint,
  getCity,
  getSubZone,
  getZone,
  importLocations,
  listStandbyPoints,
  listSubZones,
  listZones,
  updateCity,
  updateStandbyPoint,
  updateSubZone,
  updateZone,
} from '@/lib/data/locations';
import type { Extra, PageInfo } from '@/lib/types';
import { LOCATION_KINDS, type ImportLocationsInput, type ImportSummary, type LocationKind, type LocationSummary, type LocationTarget, type SaveLocationInput } from './types';

const REVALIDATE = '/admin/locations';
/** A zone, sub-zone or standby point code: the same rule the CSV import applies. */
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;
const MAX_RADIUS_KM = 100;
const PAGE = 200;

type Fields = Readonly<Record<string, unknown>>;

const isKind = (value: unknown): value is LocationKind => (LOCATION_KINDS as readonly unknown[]).includes(value);
const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const nullIfEmpty = (value: string): string | null => (value === '' ? null : value);

/** A number the person typed, or undefined when they left it empty. Anything else that is not a number is refused. */
function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidInputError(`${label}: must be a number.`);
  return value;
}

/** The stored record, or undefined if unreadable. */
async function stored<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return undefined;
    throw error;
  }
}

async function everyPage<T>(fetch: (cursor: string | undefined) => Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

const codeOf = (extra: Extra | undefined): string => (typeof extra?.['code'] === 'string' ? extra['code'] : '');

async function codesOf(ctx: RequestContext, kind: Exclude<LocationKind, 'city'>): Promise<string[]> {
  const page = (cursor: string | undefined) => ({ limit: PAGE, ...(cursor === undefined ? {} : { cursor }) });
  if (kind === 'zone') return (await everyPage((cursor) => listZones(ctx, page(cursor)))).map((z) => codeOf(z.extra));
  if (kind === 'sub_zone') return (await everyPage((cursor) => listSubZones(ctx, page(cursor)))).map((s) => codeOf(s.extra));
  return (await everyPage((cursor) => listStandbyPoints(ctx, page(cursor)))).map((p) => codeOf(p.extra));
}

/** A new code: well formed and not used yet. */
async function checkNewCode(ctx: RequestContext, kind: Exclude<LocationKind, 'city'>, code: string): Promise<void> {
  if (!CODE.test(code)) throw new InvalidInputError('Code: 1 to 32 letters, digits, dots, dashes or underscores.');
  const used = await stored(() => codesOf(ctx, kind));
  if (used?.includes(code) === true) throw new ConflictError(`Code ${code} is already used.`);
}

async function saveCity(ctx: RequestContext, input: Fields, targetId: string | undefined): Promise<LocationSummary> {
  const nameAr = nullIfEmpty(textOf(input['name_ar']));
  const active = input['is_active'] === true;
  if (targetId === undefined) {
    const city = await createCity(ctx, { case_code: textOf(input['code']), name_en: textOf(input['name_en']), name_ar: nameAr, is_active: active });
    return { kind: 'city', id: city.id, name: city.name_en, created: true };
  }
  const current = await stored(() => getCity(ctx, targetId));
  const kept = current === undefined ? {} : { external_id: current.external_id, case_code: current.case_code, extra: current.extra ?? {} };
  const city = await updateCity(ctx, targetId, { ...kept, name_en: textOf(input['name_en']), name_ar: nameAr, is_active: active });
  return { kind: 'city', id: city.id, name: city.name_en, created: false };
}

async function saveZone(ctx: RequestContext, input: Fields, targetId: string | undefined): Promise<LocationSummary> {
  const latitude = optionalNumber(input['latitude'], 'Latitude');
  const longitude = optionalNumber(input['longitude'], 'Longitude');
  const radius = optionalNumber(input['radius'], 'Radius');
  if (radius !== undefined && (radius <= 0 || radius > MAX_RADIUS_KM)) throw new InvalidInputError(`Radius: a number of kilometres above 0 and up to ${MAX_RADIUS_KM}.`);
  // A zone has a position or none; the data layer refuses one coordinate without the other.
  const position = latitude === undefined && longitude === undefined ? {} : { latitude, longitude };
  const write = { city_id: input['parent_id'], name_en: textOf(input['name_en']), name_ar: nullIfEmpty(textOf(input['name_ar'])), ...position, is_active: input['is_active'] === true };
  if (targetId === undefined) {
    const code = textOf(input['code']);
    await checkNewCode(ctx, 'zone', code);
    const zone = await createZone(ctx, { ...write, extra: { code, ...(radius === undefined ? {} : { radius_km: radius }) } });
    return { kind: 'zone', id: zone.id, name: zone.name_en, created: true };
  }
  const current = await stored(() => getZone(ctx, targetId));
  const kept = Object.fromEntries(Object.entries(current?.extra ?? {}).filter(([key]) => key !== 'radius_km'));
  const zone = await updateZone(ctx, targetId, { ...write, external_id: current?.external_id ?? null, extra: { ...kept, ...(radius === undefined ? {} : { radius_km: radius }) } });
  return { kind: 'zone', id: zone.id, name: zone.name_en, created: false };
}

async function saveSubZone(ctx: RequestContext, input: Fields, targetId: string | undefined): Promise<LocationSummary> {
  const write = { zone_id: input['parent_id'], name_en: textOf(input['name_en']), name_ar: nullIfEmpty(textOf(input['name_ar'])), latitude: input['latitude'], longitude: input['longitude'], is_active: input['is_active'] === true };
  if (targetId === undefined) {
    const code = textOf(input['code']);
    await checkNewCode(ctx, 'sub_zone', code);
    const sub = await createSubZone(ctx, { ...write, extra: { code } });
    return { kind: 'sub_zone', id: sub.id, name: sub.name_en, created: true };
  }
  const current = await stored(() => getSubZone(ctx, targetId));
  const sub = await updateSubZone(ctx, targetId, { ...write, external_id: current?.external_id ?? null, extra: current?.extra ?? {} });
  return { kind: 'sub_zone', id: sub.id, name: sub.name_en, created: false };
}

async function findStandby(ctx: RequestContext, id: string) {
  return (await everyPage((cursor) => listStandbyPoints(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }))).find((p) => p.id === id);
}

async function saveStandby(ctx: RequestContext, input: Fields, targetId: string | undefined): Promise<LocationSummary> {
  const write = {
    zone_id: input['parent_id'],
    sub_zone_id: nullIfEmpty(textOf(input['sub_zone_id'])),
    name_en: textOf(input['name_en']),
    name_ar: nullIfEmpty(textOf(input['name_ar'])),
    latitude: input['latitude'],
    longitude: input['longitude'],
    coverage_radius_m: input['radius'],
    is_active: input['is_active'] === true,
  };
  if (targetId === undefined) {
    const code = textOf(input['code']);
    await checkNewCode(ctx, 'standby', code);
    const point = await createStandbyPoint(ctx, { ...write, extra: { code } });
    return { kind: 'standby', id: point.id, name: point.name_en, created: true };
  }
  const current = await stored(() => findStandby(ctx, targetId));
  const point = await updateStandbyPoint(ctx, targetId, { ...write, extra: current?.extra ?? {} });
  return { kind: 'standby', id: point.id, name: point.name_en, created: false };
}

/** Adds or changes a city, zone, sub-zone or standby point: `targetId` names the record being changed, and is absent for an add. */
export async function saveLocation(input: SaveLocationInput): Promise<ActionResult<LocationSummary>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['kind', 'targetId', 'name_en', 'name_ar', 'code', 'parent_id', 'sub_zone_id', 'latitude', 'longitude', 'radius', 'is_active']);
      const kind = fields.kind;
      if (!isKind(kind)) throw new InvalidInputError(`Location: kind is one of ${LOCATION_KINDS.join(', ')}.`);
      const targetId = typeof fields.targetId === 'string' && fields.targetId !== '' ? fields.targetId : undefined;
      if (kind === 'city') return saveCity(ctx, fields, targetId);
      if (kind === 'zone') return saveZone(ctx, fields, targetId);
      if (kind === 'sub_zone') return saveSubZone(ctx, fields, targetId);
      return saveStandby(ctx, fields, targetId);
    },
    { revalidate: REVALIDATE },
  );
}

/** Deletes a standby point (the only kind the data layer deletes). */
export async function deleteStandby(input: LocationTarget): Promise<ActionResult<LocationSummary>> {
  return runAction(
    async (ctx) => {
      const targetId = pickText(input, 'targetId') ?? '';
      const name = (await stored(() => findStandby(ctx, targetId)))?.name_en ?? '';
      await deleteStandbyPoint(ctx, targetId);
      return { kind: 'standby', id: targetId, name, created: false } satisfies LocationSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Imports the CSV text the browser read. One audited call: every row is checked first, and nothing is written unless all are valid. */
export async function importLocationsCsv(input: ImportLocationsInput): Promise<ActionResult<ImportSummary>> {
  return runAction(
    async (ctx) => {
      const result = await importLocations(ctx, { file: pickFields(input, ['file']).file });
      return { cities: result.cities, zones: result.zones, subZones: result.sub_zones, standbyPoints: result.standby_points, total: result.total } satisfies ImportSummary;
    },
    { revalidate: REVALIDATE },
  );
}
