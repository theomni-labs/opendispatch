// SPDX-License-Identifier: AGPL-3.0-only
// The maths behind MapView, kept apart from React so it can be tested without a DOM. Pure functions only.
//
// The projection is equirectangular: longitude and latitude map linearly to x and y, with the longitude scaled by the
// cosine of the middle latitude so that a circle on the ground stays a circle on the screen. At the scale of a city
// (tens of kilometres) that is exact enough for a schematic; it is not a map projection for navigation.

/** Kilometres in one degree of latitude. */
export const KM_PER_DEGREE = 111;

export const MIN_ZOOM = 0.75;
export const MAX_ZOOM = 2.25;
export const ZOOM_STEP = 0.25;
/** Space kept free around the data, in pixels. */
export const PADDING = 22;

/** What a pin adds to the bounds, in kilometres, so a lone pin still has an extent. */
const PIN_REACH_KM = 0.4;
/** The radius of a zone that gives none. */
const DEFAULT_RADIUS_KM = 5;

export function isCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Two decimals, like the mockup kit: keeps the path strings short and the output stable. */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface Extent {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface Reach {
  lat: number;
  lon: number;
  /** How far the thing reaches around its centre, in kilometres. */
  radiusKm?: number | undefined;
}

/** The smallest box that holds every item and its reach, or null when there is nothing to hold. */
export function extentOf(items: readonly Reach[]): Extent | null {
  const valid = items.filter((item) => isCoordinate(item.lat, item.lon));
  if (valid.length === 0) return null;
  // The middle latitude sets how wide a kilometre is in longitude.
  const midLat = valid.reduce((sum, item) => sum + item.lat, 0) / valid.length;
  const cosine = Math.max(Math.cos((midLat * Math.PI) / 180), 0.05);
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const item of valid) {
    const radiusKm = item.radiusKm !== undefined && item.radiusKm > 0 ? item.radiusKm : PIN_REACH_KM;
    const dLat = radiusKm / KM_PER_DEGREE;
    const dLon = radiusKm / (KM_PER_DEGREE * cosine);
    minLat = Math.min(minLat, item.lat - dLat);
    maxLat = Math.max(maxLat, item.lat + dLat);
    minLon = Math.min(minLon, item.lon - dLon);
    maxLon = Math.max(maxLon, item.lon + dLon);
  }
  return { minLat, maxLat, minLon, maxLon };
}

/** A zone's reach for the bounds: its radius, or a default when it gives none. */
export function zoneReach(radiusKm: number | undefined): number {
  return radiusKm !== undefined && radiusKm > 0 ? radiusKm : DEFAULT_RADIUS_KM;
}

export interface Projection {
  /** Longitude to x, in pixels. */
  x(lon: number): number;
  /** Latitude to y, in pixels (north is up). */
  y(lat: number): number;
  /** Kilometres on the ground to pixels on the screen. */
  km(km: number): number;
}

/** Fits the extent into a `width` by `height` box with `padding`, then scales it by `zoom` around the centre. */
export function projectionFor(extent: Extent, width: number, height: number, zoom: number, padding = PADDING): Projection {
  const midLat = (extent.minLat + extent.maxLat) / 2;
  const midLon = (extent.minLon + extent.maxLon) / 2;
  const cosine = Math.max(Math.cos((midLat * Math.PI) / 180), 0.05);
  const spanX = Math.max((extent.maxLon - extent.minLon) * cosine, 1e-6);
  const spanY = Math.max(extent.maxLat - extent.minLat, 1e-6);
  const availableX = Math.max(width - padding * 2, 1);
  const availableY = Math.max(height - padding * 2, 1);
  // Pixels per degree of latitude.
  const scale = Math.min(availableX / spanX, availableY / spanY) * clampZoom(zoom);
  return {
    x: (lon) => round(width / 2 + (lon - midLon) * cosine * scale),
    y: (lat) => round(height / 2 - (lat - midLat) * scale),
    km: (km) => round((km / KM_PER_DEGREE) * scale),
  };
}

/** A small seeded random generator (FNV-1a hash into mulberry32), so a zone or the roads always draw the same. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An irregular ten-sided outline around a centre, the same for the same code. Radius in pixels. */
export function zoneOutline(code: string, cx: number, cy: number, radius: number): string {
  const random = seeded(code);
  const sides = 10;
  let path = '';
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 + 0.3;
    const reach = radius * (0.82 + random() * 0.3);
    path += `${i === 0 ? 'M' : 'L'}${round(cx + reach * Math.cos(angle))} ${round(cy + reach * Math.sin(angle))}`;
  }
  return `${path}Z`;
}

/** The pixel radius of a zone's outline: a little under its nominal radius, so neighbours do not touch. */
export function zoneRadius(projection: Projection, radiusKm: number | undefined): number {
  return round(projection.km(zoneReach(radiusKm)) * 0.8);
}

export interface Road {
  d: string;
  minor: boolean;
}

/** The decorative roads of the schematic: a ring, two streets across, two down and a diagonal. Not real roads. */
export function roads(width: number, height: number, zoom: number): Road[] {
  const random = seeded('roads');
  const out: Road[] = [];
  let ring = '';
  for (let a = 0; a < 24; a++) {
    const angle = (a / 24) * Math.PI * 2;
    const reach = Math.min(width, height) * 0.34 * zoom * (0.94 + random() * 0.12);
    ring += `${a === 0 ? 'M' : 'L'}${round(width / 2 + reach * 1.35 * Math.cos(angle))} ${round(height / 2 + reach * Math.sin(angle))}`;
  }
  out.push({ d: `${ring}Z`, minor: false });
  for (const fraction of [0.28, 0.72]) {
    const y = round(height * fraction);
    const ctrlY = round(y + (random() - 0.5) * 40);
    const midY = round(y + (random() - 0.5) * 40);
    const endY = round(y + (random() - 0.5) * 30);
    out.push({ d: `M0 ${y}Q${round(width * 0.35)} ${ctrlY} ${round(width * 0.65)} ${midY}T${width} ${endY}`, minor: false });
    const x = round(width * (fraction < 0.5 ? 0.3 : 0.7));
    const ctrlX = round(x + (random() - 0.5) * 50);
    const midX = round(x + (random() - 0.5) * 40);
    const endX = round(x + (random() - 0.5) * 30);
    out.push({ d: `M${x} 0Q${ctrlX} ${round(height * 0.4)} ${midX} ${round(height * 0.7)}T${endX} ${height}`, minor: true });
  }
  out.push({ d: `M0 ${round(height * 0.55)}L${width} ${round(height * 0.5)}`, minor: true });
  return out;
}

/** Places further apart than this belong to different cities, and one view cannot show both. */
export const CITY_GAP_KM = 60;

/** The ground distance between two points, in kilometres (equirectangular, fine at city and country scale). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const cosine = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (a.lon - b.lon) * cosine * KM_PER_DEGREE;
  const dy = (a.lat - b.lat) * KM_PER_DEGREE;
  return Math.hypot(dx, dy);
}

/**
 * Which points belong to the main group: the largest set of points that chain together within `gapKm` of each other
 * (the first such set wins a tie). A map that fits a whole country puts every city in a corner; this picks one to fit.
 */
export function mainGroupMask(points: readonly { lat: number; lon: number }[], gapKm = CITY_GAP_KM): boolean[] {
  const parent = points.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    return root;
  };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      if (a && b && find(i) !== find(j) && distanceKm(a, b) <= gapKm) parent[find(i)] = find(j);
    }
  }
  const sizes = new Map<number, number>();
  for (let i = 0; i < points.length; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
  let best = -1;
  let bestSize = 0;
  for (let i = 0; i < points.length; i++) {
    const root = find(i);
    const size = sizes.get(root) ?? 0;
    if (size > bestSize) {
      best = root;
      bestSize = size;
    }
  }
  return points.map((_, index) => find(index) === best);
}

export interface Placed {
  id: string;
  x: number;
  y: number;
}

/**
 * Moves points that sit closer than `minDistance` (pixels) onto rings around their shared centre, so each stays
 * visible and none covers another. A point with no close neighbour does not move. Same input, same output.
 */
export function spreadPoints(points: readonly Placed[], minDistance: number): Placed[] {
  const groups: { cx: number; cy: number; members: number[] }[] = [];
  points.forEach((point, index) => {
    const group = groups.find((g) => Math.hypot(g.cx - point.x, g.cy - point.y) < minDistance);
    if (group) {
      const n = group.members.length;
      group.cx = (group.cx * n + point.x) / (n + 1);
      group.cy = (group.cy * n + point.y) / (n + 1);
      group.members.push(index);
    } else {
      groups.push({ cx: point.x, cy: point.y, members: [index] });
    }
  });
  const out = points.map((point) => ({ ...point }));
  for (const group of groups) {
    if (group.members.length < 2) continue;
    let ring = 0;
    let slot = 0;
    let capacity = 1;
    for (const member of group.members) {
      const target = out[member];
      if (!target) continue;
      if (slot >= capacity) {
        ring += 1;
        slot = 0;
        capacity = Math.max(Math.floor(2 * Math.PI * ring), 3);
      }
      if (ring === 0) {
        target.x = round(group.cx);
        target.y = round(group.cy);
      } else {
        const angle = (slot / capacity) * Math.PI * 2 - Math.PI / 2 + ring * 0.5;
        target.x = round(group.cx + ring * minDistance * Math.cos(angle));
        target.y = round(group.cy + ring * minDistance * Math.sin(angle));
      }
      slot += 1;
    }
  }
  return out;
}

export interface LabelBox {
  key: string;
  /** The middle of the text, in pixels. */
  x: number;
  y: number;
  /** The text's width and height, in pixels. */
  width: number;
  height: number;
}

/** The keys of the labels to draw, in order of priority: a label that would overlap one already kept is dropped. */
export function fittingLabels(labels: readonly LabelBox[]): Set<string> {
  const kept: LabelBox[] = [];
  for (const label of labels) {
    const clear = kept.every((other) => Math.abs(label.x - other.x) * 2 >= label.width + other.width || Math.abs(label.y - other.y) * 2 >= label.height + other.height);
    if (clear) kept.push(label);
  }
  return new Set(kept.map((label) => label.key));
}
