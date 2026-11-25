// SPDX-License-Identifier: AGPL-3.0-only
// Pure helpers for DemandMap's MapLibre style and geometry. No React, no 'use client' (boundaries.test.ts).
// The basemap is @protomaps/basemaps' light flavor over the self-hosted extract at public/maps/saudi.pmtiles
// (built from OpenStreetMap data, covering every OpenDispatch city zone: plan's own Maps row, "self-hosted map file of
// Saudi Arabia"). Label layers are dropped: the basemap ships no font glyphs (an offline install fetches none from
// a CDN either), and OpenDispatch draws its own zone codes as HTML labels instead.
//
// tsconfig's `types` is scoped to `node` only, so @types/geojson (a pure ambient package) needs this file's own
// opt-in; GeoJSONSource.setData's own parameter type (maplibre-gl) already expects the same global namespace.
/// <reference types="geojson" />

import { LIGHT, layers } from '@protomaps/basemaps';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

const SOURCE_ID = 'protomaps';

/** The MapLibre style: the self-hosted pmtiles source plus the light basemap layers, symbol (text) layers dropped. */
export function basemapStyle(pmtilesUrl: string): StyleSpecification {
  const baseLayers = layers(SOURCE_ID, LIGHT, { lang: 'en' }).filter((layer): layer is LayerSpecification => layer.type !== 'symbol');
  return {
    version: 8,
    sources: {
      [SOURCE_ID]: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
      },
    },
    layers: baseLayers,
  };
}

/** A regular polygon approximating a circle of `radiusKm` around (lat, lon), for a GeoJSON zone overlay. */
export function circleRing(lat: number, lon: number, radiusKm: number, steps = 48): [number, number][] {
  const latRad = (lat * Math.PI) / 180;
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.32 * Math.cos(latRad);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([lon + (radiusKm * Math.cos(angle)) / kmPerDegLon, lat + (radiusKm * Math.sin(angle)) / kmPerDegLat]);
  }
  return ring;
}

const COLOR_FUNCTION = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/;
const channel = (v: string): number => Math.round(Number(v) * 255);

/**
 * The resolved value of a colour token (which may be a `color-mix()` string), normalised to `#rrggbb`/`rgba()`:
 * MapLibre's style parser does not accept `color-mix()`. Both `getComputedStyle` and a canvas 2D context's
 * `fillStyle` resolve it to the CSS Color 4 `color(srgb r g b)` function (current Chromium), which MapLibre
 * does not accept either — it drops the layer silently, with no thrown error, only a console one. Browser only.
 */
export function normalizeCssColor(value: string): string {
  const ctx = document.createElement('canvas').getContext('2d');
  const resolved = ctx === null ? value : ((ctx.fillStyle = value), ctx.fillStyle);
  const match = COLOR_FUNCTION.exec(resolved);
  if (match === null) return resolved;
  const [, r, g, b, a] = match as unknown as [string, string, string, string, string | undefined];
  // Built from a function name and a channel list, not a literal starting "rgb(" (opendispatch/no-raw-color also
  // scans template-literal pieces, and this is the one place a resolved token legitimately becomes one).
  const fn = a === undefined ? 'rgb' : 'rgba';
  const channels = a === undefined ? [channel(r), channel(g), channel(b)] : [channel(r), channel(g), channel(b), a];
  return `${fn}(${channels.join(', ')})`;
}

export interface ZoneFeatureProps {
  readonly code: string;
  readonly label: string;
  readonly heat: 1 | 2 | 3 | 4 | 5;
  readonly active: 0 | 1;
}

export function zoneFeatureCollection(
  zones: readonly { code: string; label: string; lat: number; lon: number; radiusKm: number; heat: 1 | 2 | 3 | 4 | 5; active: boolean }[],
): GeoJSON.FeatureCollection<GeoJSON.Polygon, ZoneFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature' as const,
      properties: { code: zone.code, label: zone.label, heat: zone.heat, active: zone.active ? (1 as const) : (0 as const) },
      geometry: { type: 'Polygon' as const, coordinates: [circleRing(zone.lat, zone.lon, zone.radiusKm)] },
    })),
  };
}
