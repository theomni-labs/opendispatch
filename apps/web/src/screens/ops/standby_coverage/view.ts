// SPDX-License-Identifier: AGPL-3.0-only
// Standby and Coverage view (server only)

import { addDays } from '@/lib/day';
import { moduleAccess } from '@/lib/access';
import { getCoverage, recommendStandbyMoves } from '@/lib/data/standby';
import { listStandbyPoints, listSubZones, listZones } from '@/lib/data/locations';
import { getDemoToday } from '@/lib/data/settings';
import type { RequestContext } from '@/lib/data/guard';
import type { DataSource, StandbyPoint, Zone } from '@/lib/types';

const DEFAULT_ZONE_RADIUS_KM = 6;

export interface ZoneOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface ZoneShape extends ZoneOption {
  readonly lat: number;
  readonly lon: number;
  readonly radiusKm: number;
}

export interface CoveragePointRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly radiusKm: number;
  readonly agents: number;
  readonly coversCount: number;
  readonly coveredSubZoneIds: readonly string[];
  readonly reachMinutes: number | null;
  // Km from the zone's dispatch centre (4.4).
  readonly homeKm: number | null;
  readonly beyondLimit: boolean;
}

export interface CoverageSubZoneRow {
  readonly id: string;
  readonly code: string;
  /** Last two chars of the code (map label). */
  readonly label: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly covered: boolean;
}

export interface UncoveredRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface RecommendedMoveView {
  readonly fromId: string;
  readonly fromName: string;
  readonly toId: string;
  readonly toName: string;
  readonly agents: number;
  /** The data layer's own reason, English only. */
  readonly reasonEn: string;
}

export interface CoverageStats {
  readonly points: number;
  readonly waiting: number;
  readonly coveredCount: number;
  readonly subZoneCount: number;
  readonly uncoveredCount: number;
  readonly reachShare: number | null;
}

export interface StandbyCoverageView {
  readonly zone: ZoneShape;
  readonly zoneOptions: readonly ZoneOption[];
  readonly date: string;
  readonly sources: readonly DataSource[];
  readonly canOpenLocations: boolean;
  readonly stats: CoverageStats;
  readonly points: readonly CoveragePointRow[];
  readonly limitKm: number | null;
  readonly subZones: readonly CoverageSubZoneRow[];
  readonly uncovered: readonly UncoveredRow[];
  readonly move: RecommendedMoveView | null;
}

// ---- Pure helpers ----

/** Demand share beyond 10 minutes, from the reach share. */
export function outOfReach(reachShare: number): number {
  return Math.max(0, Math.min(1, 1 - reachShare));
}


function extraCode(
  record: { readonly extra?: Readonly<Record<string, unknown>> | undefined },
  fallback: string,
): string {
  const code = record.extra?.['code'];
  return typeof code === 'string' ? code : fallback;
}

function zoneOptionOf(zone: Zone): ZoneOption {
  return { id: zone.id, code: extraCode(zone, zone.id), name: zone.name_en };
}

function zoneShapeOf(zone: Zone): ZoneShape {
  const radius = zone.extra?.['radius_km'];
  return {
    ...zoneOptionOf(zone),
    lat: zone.latitude ?? 0,
    lon: zone.longitude ?? 0,
    radiusKm: typeof radius === 'number' ? radius : DEFAULT_ZONE_RADIUS_KM,
  };
}

/** Name minus the fixture's " standby" tail. */
function pointName(point: StandbyPoint | undefined): string {
  if (point === undefined) return '—';
  return point.name_en.replace(/ standby$/iu, '');
}

function emptyView(zone: ZoneShape, zoneOptions: readonly ZoneOption[], date: string, sources: readonly DataSource[], canOpenLocations: boolean, subZoneCount = 0): StandbyCoverageView {
  return {
    zone,
    zoneOptions,
    date,
    sources,
    canOpenLocations,
    stats: { points: 0, waiting: 0, coveredCount: 0, subZoneCount, uncoveredCount: subZoneCount, reachShare: null },
    points: [],
    limitKm: null,
    subZones: [],
    uncovered: [],
    move: null,
  };
}

// ---- Loader ----

export interface StandbyCoverageQuery {
  readonly zone?: string | undefined;
  readonly date?: string | undefined;
}

export async function loadStandbyCoverageView(ctx: RequestContext, query: StandbyCoverageQuery): Promise<StandbyCoverageView> {
  const sources: DataSource[] = ['SYNTHETIC'];
  const zones = (await listZones(ctx, { limit: 200 })).items;
  const zoneOptions = zones.map(zoneOptionOf).sort((a, b) => a.name.localeCompare(b.name));
  const canOpenLocations = moduleAccess(ctx.role, 'admin.locations', ctx.installMode).access !== 'none';

  const today = await getDemoToday(ctx);
  const date = query.date ?? addDays(today, 1);

  const requestedZone = query.zone === undefined ? undefined : zones.find((z) => z.id === query.zone);
  const zone = requestedZone ?? zones[0];

  if (zone === undefined) {
    return emptyView({ id: '', code: '', name: '', lat: 0, lon: 0, radiusKm: DEFAULT_ZONE_RADIUS_KM }, [], date, sources, canOpenLocations);
  }
  const zoneShape = zoneShapeOf(zone);

  const points = (await listStandbyPoints(ctx, { zone_id: zone.id, limit: 200 })).items.filter((p) => p.is_active);
  const subZoneRows = (await listSubZones(ctx, { zone_id: zone.id, limit: 200 })).items.filter((s) => s.is_active);

  if (points.length === 0) {
    return emptyView(zoneShape, zoneOptions, date, sources, canOpenLocations, subZoneRows.length);
  }

  const coverage = await getCoverage(ctx, { zone_id: zone.id, date });
  const recommendation = await recommendStandbyMoves(ctx, { zone_id: zone.id, date });

  const pointsById = new Map(points.map((p) => [p.id, p] as const));
  const subById = new Map(subZoneRows.map((s) => [s.id, s] as const));
  const uncoveredIds = new Set(coverage.uncovered_sub_zone_ids);

  const pointRows: CoveragePointRow[] = coverage.areas
    .filter((area) => pointsById.has(area.standby_point_id))
    .map((area) => {
      const point = pointsById.get(area.standby_point_id) as StandbyPoint;
      return {
        id: point.id,
        code: extraCode(point, point.id),
        name: pointName(point),
        lat: point.latitude,
        lon: point.longitude,
        radiusKm: area.coverage_radius_m / 1000,
        agents: area.recommended_agents,
        coversCount: area.covered_sub_zone_ids.length,
        coveredSubZoneIds: area.covered_sub_zone_ids,
        reachMinutes: area.reach_minutes ?? null,
        homeKm: area.home_distance_km ?? null,
        beyondLimit: area.beyond_deploy_limit === true,
      } satisfies CoveragePointRow;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const subZoneViewRows: CoverageSubZoneRow[] = subZoneRows.map((s) => {
    const code = extraCode(s, s.id);
    return { id: s.id, code, label: code.slice(-2), name: s.name_en, lat: s.latitude, lon: s.longitude, covered: !uncoveredIds.has(s.id) };
  });

  const uncoveredRows: UncoveredRow[] = [...uncoveredIds]
    .map((id) => subById.get(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .map((s) => ({ id: s.id, code: extraCode(s, s.id), name: s.name_en }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const firstMove = recommendation.moves[0];
  const move: RecommendedMoveView | null =
    firstMove === undefined
      ? null
      : {
          fromId: firstMove.from_standby_point_id,
          fromName: pointName(pointsById.get(firstMove.from_standby_point_id)),
          toId: firstMove.to_standby_point_id,
          toName: pointName(pointsById.get(firstMove.to_standby_point_id)),
          agents: firstMove.agents,
          reasonEn: firstMove.reason_en,
        };

  const waiting = coverage.areas.reduce((sum, a) => sum + a.recommended_agents, 0);

  return {
    zone: zoneShape,
    zoneOptions,
    date,
    sources,
    canOpenLocations,
    stats: {
      points: points.length,
      waiting,
      coveredCount: subZoneRows.length - uncoveredRows.length,
      subZoneCount: subZoneRows.length,
      uncoveredCount: uncoveredRows.length,
      reachShare: coverage.reach_share ?? null,
    },
    points: pointRows,
    limitKm: coverage.max_deploy_distance_km ?? null,
    subZones: subZoneViewRows,
    uncovered: uncoveredRows,
    move,
  };
}
