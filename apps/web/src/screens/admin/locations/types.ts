// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Locations screen: what the server side hands to the client files. Everything
// here is JSON-safe, so it can cross from the Server Component to the tables and forms. Nothing here is a context, a
// customer or the caller's role.

import type { LiveStage } from '@/lib/types';

export type LocationKind = 'city' | 'zone' | 'sub_zone' | 'standby';

export const LOCATION_KINDS = ['city', 'zone', 'sub_zone', 'standby'] as const satisfies readonly LocationKind[];

export interface CityRow {
  readonly id: string;
  /** The two-letter case code (RD). */
  readonly code: string;
  readonly name: string;
  /** Null until the customer supplies Arabic names: the screen falls back to English. */
  readonly nameAr: string | null;
  readonly active: boolean;
  readonly zoneIds: readonly string[];
}

export interface ZoneRow {
  readonly id: string;
  readonly cityId: string;
  readonly cityCode: string;
  /** `extra.code` (RD-C); the name when a zone has none. */
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** `extra.radius_km`, drawn as the zone's circle on the map. */
  readonly radiusKm: number | null;
  readonly active: boolean;
  /** The live-assignment stage of the zone (a setting, read only here). */
  readonly stage: LiveStage;
  readonly subZones: number;
  readonly standbyPoints: number;
  readonly agents: number;
}

export interface SubZoneRow {
  readonly id: string;
  readonly zoneId: string;
  readonly zoneCode: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly active: boolean;
}

export interface StandbyRow {
  readonly id: string;
  readonly zoneId: string;
  readonly zoneCode: string;
  readonly subZoneId: string | null;
  readonly subZoneName: string | null;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusM: number;
  readonly active: boolean;
}

/** One record of any kind, in the shape the edit drawer's form needs. */
export interface LocationRecord {
  readonly kind: LocationKind;
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly active: boolean;
  /** The city (for a zone) or the zone (for a sub-zone and a standby point); null for a city. */
  readonly parentId: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Kilometres for a zone, metres for a standby point. */
  readonly radius: number | null;
  readonly subZoneId: string | null;
  readonly stage: LiveStage | null;
}

export interface ZoneOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly cityId: string;
}

export interface SubZoneOption {
  readonly id: string;
  readonly zoneId: string;
  readonly name: string;
}

/** The address bar's `edit=<kind>:<id|new>`, split. */
export type EditTarget = { readonly kind: LocationKind; readonly id: string | 'new' };

/** The pin on the map that opens a standby point. */
export interface MapStandby {
  readonly id: string;
  readonly zoneCode: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
}

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types:
// no field here is a context, customer, user, role, zone scope or install mode.
// ---------------------------------------------------------------------------------------------

export interface SaveLocationInput {
  readonly kind: LocationKind;
  /** The record being changed; absent when a location is added. */
  readonly targetId?: string | undefined;
  readonly name_en: string;
  /** Empty: no Arabic name (English is shown). */
  readonly name_ar: string;
  readonly code: string;
  /** The city id of a zone, the zone id of a sub-zone or a standby point; empty for a city. */
  readonly parent_id: string;
  /** A standby point's sub-zone id; empty for none. */
  readonly sub_zone_id: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Kilometres for a zone, metres for a standby point. */
  readonly radius: number | null;
  readonly is_active: boolean;
}

export interface LocationTarget {
  readonly targetId: string;
}

export interface ImportLocationsInput {
  /** The text of the CSV file, read in the browser. */
  readonly file: string;
}

export interface LocationSummary {
  readonly kind: LocationKind;
  readonly id: string;
  readonly name: string;
  readonly created: boolean;
}

export interface ImportSummary {
  readonly cities: number;
  readonly zones: number;
  readonly subZones: number;
  readonly standbyPoints: number;
  readonly total: number;
}
