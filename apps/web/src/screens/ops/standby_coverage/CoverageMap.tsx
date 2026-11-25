'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { MapView, type MapCover, type MapPin, type MapSelection, type MapZone } from '@/components/opendispatch/MapView';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import type { CoveragePointRow, CoverageSubZoneRow, ZoneShape } from './view';

// Coverage map (#sc-map-host); a pin sets ?pt=

// Sub-zone circle radius (mockup: 1.6km).
const SUB_ZONE_RADIUS_KM = 1.6;
// Outer frame vs the zone's own radius.
const FRAME_MULTIPLIER = 1.4;

export interface CoverageMapProps {
  readonly zone: ZoneShape;
  readonly points: readonly CoveragePointRow[];
  readonly subZones: readonly CoverageSubZoneRow[];
  readonly selectedPointId: string | null;
  readonly label: string;
}

export function CoverageMap({ zone, points, subZones, selectedPointId, label }: CoverageMapProps) {
  const url = useUrlState();
  const selectedPoint = points.find((p) => p.id === selectedPointId);
  const coveredIds = new Set(selectedPoint?.coveredSubZoneIds ?? []);

  const zones: MapZone[] = [
    { code: zone.code, label: ' ', lat: zone.lat, lon: zone.lon, radiusKm: zone.radiusKm * FRAME_MULTIPLIER, stage: 'none' },
    ...subZones.map(
      (s): MapZone => ({
        code: s.code,
        label: s.label,
        lat: s.lat,
        lon: s.lon,
        radiusKm: SUB_ZONE_RADIUS_KM,
        stage: s.covered ? 'shadow' : 'gap',
        active: selectedPoint !== undefined && coveredIds.has(s.id),
      }),
    ),
  ];
  const pins: MapPin[] = points.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, kind: 'standby', label: `${p.name} (${p.agents})`, selected: p.id === selectedPointId }));
  const cover: MapCover[] = (selectedPoint === undefined ? points : [selectedPoint]).map((p) => ({ lat: p.lat, lon: p.lon, radiusKm: p.radiusKm }));

  const onSelect = (selection: MapSelection) => {
    if (selection.kind !== 'pin') return;
    url.update({ pt: selection.id === selectedPointId ? null : selection.id });
  };

  return <MapView zones={zones} pins={pins} cover={cover} label={label} height={440} onSelect={onSelect} />;
}
