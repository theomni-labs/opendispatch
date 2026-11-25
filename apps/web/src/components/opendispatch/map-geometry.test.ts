// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  KM_PER_DEGREE,
  MAX_ZOOM,
  MIN_ZOOM,
  PADDING,
  CITY_GAP_KM,
  clampZoom,
  distanceKm,
  extentOf,
  fittingLabels,
  isCoordinate,
  mainGroupMask,
  projectionFor,
  roads,
  round,
  seeded,
  spreadPoints,
  zoneOutline,
  zoneRadius,
  zoneReach,
} from './map-geometry';

const RIYADH = [
  { lat: 24.71, lon: 46.68, radiusKm: 6 },
  { lat: 24.71, lon: 46.7987, radiusKm: 6.5 },
  { lat: 24.71, lon: 46.5613, radiusKm: 6.5 },
  { lat: 24.73, lon: 46.7 },
];

describe('isCoordinate', () => {
  it('accepts real coordinates and refuses the rest', () => {
    expect(isCoordinate(24.7, 46.7)).toBe(true);
    expect(isCoordinate(0, 0)).toBe(true);
    expect(isCoordinate(Number.NaN, 46.7)).toBe(false);
    expect(isCoordinate(24.7, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isCoordinate(91, 0)).toBe(false);
    expect(isCoordinate(0, 181)).toBe(false);
  });
});

describe('extentOf', () => {
  it('is null when there is nothing (or nothing valid) to hold', () => {
    expect(extentOf([])).toBeNull();
    expect(extentOf([{ lat: Number.NaN, lon: 1 }])).toBeNull();
  });

  it('holds every centre plus its reach in kilometres', () => {
    const extent = extentOf(RIYADH);
    expect(extent).not.toBeNull();
    if (!extent) return;
    for (const item of RIYADH) {
      expect(extent.minLat).toBeLessThanOrEqual(item.lat);
      expect(extent.maxLat).toBeGreaterThanOrEqual(item.lat);
      expect(extent.minLon).toBeLessThanOrEqual(item.lon);
      expect(extent.maxLon).toBeGreaterThanOrEqual(item.lon);
    }
    // The tallest reach is 6.5 km, so the box is at least 13 km high (111 km per degree of latitude).
    expect((extent.maxLat - extent.minLat) * KM_PER_DEGREE).toBeGreaterThanOrEqual(13);
  });

  it('gives a lone pin a small extent, so there is never a division by zero', () => {
    const extent = extentOf([{ lat: 24.7, lon: 46.7 }]);
    expect(extent).not.toBeNull();
    if (!extent) return;
    expect(extent.maxLat).toBeGreaterThan(extent.minLat);
    expect(extent.maxLon).toBeGreaterThan(extent.minLon);
    const projection = projectionFor(extent, 640, 360, 1);
    expect(projection.x(46.7)).toBeCloseTo(320, 0);
    expect(projection.y(24.7)).toBeCloseTo(180, 0);
  });
});

describe('projectionFor', () => {
  const extent = extentOf(RIYADH);
  if (!extent) throw new Error('fixture has no extent');

  it('fits the whole extent inside the frame, with the padding', () => {
    const p = projectionFor(extent, 640, 360, 1);
    expect(p.x(extent.minLon)).toBeGreaterThanOrEqual(PADDING - 0.01);
    expect(p.x(extent.maxLon)).toBeLessThanOrEqual(640 - PADDING + 0.01);
    expect(p.y(extent.maxLat)).toBeGreaterThanOrEqual(PADDING - 0.01);
    expect(p.y(extent.minLat)).toBeLessThanOrEqual(360 - PADDING + 0.01);
    // It uses the full room in the tighter direction.
    const usedX = p.x(extent.maxLon) - p.x(extent.minLon);
    const usedY = p.y(extent.minLat) - p.y(extent.maxLat);
    expect(Math.max(usedX / (640 - 2 * PADDING), usedY / (360 - 2 * PADDING))).toBeCloseTo(1, 1);
  });

  it('puts east to the right and north up, whatever the language of the page', () => {
    const p = projectionFor(extent, 640, 360, 1);
    expect(p.x(46.8)).toBeGreaterThan(p.x(46.6));
    expect(p.y(24.75)).toBeLessThan(p.y(24.7));
  });

  it('keeps a circle a circle: a kilometre is as long east-west as north-south', () => {
    const p = projectionFor(extent, 640, 360, 1);
    const km = p.km(1);
    const dLat = 1 / KM_PER_DEGREE;
    const dLon = 1 / (KM_PER_DEGREE * Math.cos((24.71 * Math.PI) / 180));
    expect(Math.abs(p.y(24.71 + dLat) - p.y(24.71))).toBeCloseTo(km, 0);
    expect(Math.abs(p.x(46.68 + dLon) - p.x(46.68))).toBeCloseTo(km, 0);
  });

  it('zooms around the centre and clamps the zoom', () => {
    const one = projectionFor(extent, 640, 360, 1);
    const two = projectionFor(extent, 640, 360, 2);
    const centreLon = (extent.minLon + extent.maxLon) / 2;
    expect(two.x(centreLon)).toBeCloseTo(one.x(centreLon), 0);
    expect(two.km(1) / one.km(1)).toBeCloseTo(2, 1);
    expect(projectionFor(extent, 640, 360, 10).km(1)).toBeCloseTo(projectionFor(extent, 640, 360, MAX_ZOOM).km(1), 5);
    expect(projectionFor(extent, 640, 360, 0.1).km(1)).toBeCloseTo(projectionFor(extent, 640, 360, MIN_ZOOM).km(1), 5);
  });

  it('survives a frame smaller than its padding', () => {
    const p = projectionFor(extent, 10, 10, 1);
    expect(Number.isFinite(p.x(46.7))).toBe(true);
    expect(Number.isFinite(p.km(5))).toBe(true);
  });
});

describe('clampZoom and round', () => {
  it('keeps the zoom in range and rounds to two decimals', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(round(1.23456)).toBe(1.23);
  });
});

describe('seeded', () => {
  it('gives the same sequence for the same seed and a different one for another', () => {
    const a = seeded('RD-C');
    const b = seeded('RD-C');
    const c = seeded('RD-E');
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('zoneOutline', () => {
  it('is a closed ten-sided outline that never changes for the same code', () => {
    const outline = zoneOutline('RD-C', 100, 100, 40);
    expect(outline).toBe(zoneOutline('RD-C', 100, 100, 40));
    expect(outline).not.toBe(zoneOutline('RD-E', 100, 100, 40));
    expect(outline.startsWith('M')).toBe(true);
    expect(outline.endsWith('Z')).toBe(true);
    expect(outline.match(/L/g)).toHaveLength(9);
  });

  it('stays near its radius', () => {
    const outline = zoneOutline('RD-C', 0, 0, 100);
    const points = [...outline.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Math.hypot(Number(m[1]), Number(m[2])));
    expect(points).toHaveLength(10);
    for (const distance of points) {
      expect(distance).toBeGreaterThanOrEqual(81);
      expect(distance).toBeLessThanOrEqual(113);
    }
  });
});

describe('zoneRadius and zoneReach', () => {
  it('draws a zone a little under its nominal radius, and gives a zone with no radius a default', () => {
    const extent = extentOf(RIYADH);
    if (!extent) throw new Error('fixture has no extent');
    const p = projectionFor(extent, 640, 360, 1);
    expect(zoneRadius(p, 6)).toBeCloseTo(p.km(6) * 0.8, 1);
    expect(zoneReach(undefined)).toBe(5);
    expect(zoneReach(0)).toBe(5);
    expect(zoneReach(3)).toBe(3);
  });
});

describe('roads', () => {
  it('draws the same schematic every time: a ring, two streets across, two down and a diagonal', () => {
    const drawn = roads(640, 360, 1);
    expect(drawn).toEqual(roads(640, 360, 1));
    expect(drawn).toHaveLength(6);
    expect(drawn.filter((road) => road.minor)).toHaveLength(3);
    for (const road of drawn) expect(road.d).toMatch(/^M/);
  });

  it('follows the size of the frame and the zoom', () => {
    expect(roads(640, 360, 1)).not.toEqual(roads(800, 360, 1));
    expect(roads(640, 360, 1)[0]?.d).not.toBe(roads(640, 360, 2)[0]?.d);
  });
});

describe('mainGroupMask', () => {
  const riyadh = [
    { lat: 24.71, lon: 46.68 },
    { lat: 24.75, lon: 46.7 },
    { lat: 24.68, lon: 46.62 },
  ];
  const jeddah = { lat: 21.54, lon: 39.17 };
  const dammam = { lat: 26.43, lon: 50.1 };

  it('measures ground distance', () => {
    expect(distanceKm(riyadh[0]!, riyadh[0]!)).toBe(0);
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(KM_PER_DEGREE, 5);
    expect(distanceKm(riyadh[0]!, jeddah)).toBeGreaterThan(800);
  });

  it('keeps the biggest city and drops the others', () => {
    const mask = mainGroupMask([jeddah, ...riyadh, dammam]);
    expect(mask).toEqual([false, true, true, true, false]);
  });

  it('keeps everything when it is all one city, and chains places within the gap', () => {
    expect(mainGroupMask(riyadh)).toEqual([true, true, true]);
    const chain = [0, 1, 2].map((i) => ({ lat: 24 + (i * (CITY_GAP_KM - 5)) / KM_PER_DEGREE, lon: 46 }));
    expect(mainGroupMask(chain)).toEqual([true, true, true]);
  });

  it('breaks a tie towards the first group and handles nothing', () => {
    expect(mainGroupMask([jeddah, dammam])).toEqual([true, false]);
    expect(mainGroupMask([])).toEqual([]);
  });

  it('fits the view to the chosen city, not to the country', () => {
    const all = [jeddah, ...riyadh, dammam];
    const mask = mainGroupMask(all);
    const city = extentOf(all.filter((_, index) => mask[index]));
    const country = extentOf(all);
    const cityProjection = projectionFor(city!, 640, 420, 1);
    const countryProjection = projectionFor(country!, 640, 420, 1);
    const spread = (projection: ReturnType<typeof projectionFor>) => Math.abs(projection.x(riyadh[1]!.lon) - projection.x(riyadh[2]!.lon));
    expect(spread(cityProjection)).toBeGreaterThan(spread(countryProjection) * 10);
    expect(cityProjection.x(riyadh[1]!.lon)).toBeGreaterThan(PADDING - 1);
    expect(cityProjection.x(riyadh[1]!.lon)).toBeLessThan(640 - PADDING + 1);
  });
});

describe('spreadPoints', () => {
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  it('leaves points that do not meet where they are', () => {
    const points = [
      { id: 'a', x: 10, y: 10 },
      { id: 'b', x: 100, y: 100 },
    ];
    expect(spreadPoints(points, 18)).toEqual(points);
  });

  it('moves coincident points apart, at least the minimum from one another', () => {
    const points = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, x: 200, y: 150 }));
    const out = spreadPoints(points, 18);
    expect(out.map((p) => p.id)).toEqual(points.map((p) => p.id));
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) expect(distance(out[i]!, out[j]!)).toBeGreaterThanOrEqual(17);
    }
  });

  it('is the same every time and keeps the centre of a pair', () => {
    const pair = [
      { id: 'a', x: 50, y: 50 },
      { id: 'b', x: 52, y: 50 },
    ];
    expect(spreadPoints(pair, 18)).toEqual(spreadPoints(pair, 18));
    expect(spreadPoints([], 18)).toEqual([]);
  });
});

describe('fittingLabels', () => {
  it('keeps the first of two labels that overlap and every label that is clear', () => {
    const kept = fittingLabels([
      { key: 'a', x: 100, y: 50, width: 40, height: 16 },
      { key: 'b', x: 110, y: 52, width: 40, height: 16 },
      { key: 'c', x: 200, y: 50, width: 40, height: 16 },
      { key: 'd', x: 110, y: 80, width: 40, height: 16 },
    ]);
    expect([...kept]).toEqual(['a', 'c', 'd']);
  });
});
