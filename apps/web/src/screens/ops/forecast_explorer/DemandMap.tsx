'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import 'maplibre-gl/dist/maplibre-gl.css';
import { Button, EmptyState, IconButton, Select, Skeleton } from '@opendispatch/ui';
import { readTokens } from '@opendispatch/ui/tokens';
import { Map as MaplibreMap, NavigationControl, addProtocol, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
import { Crosshair, Map as MapIcon, MapPinOff, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { num } from '@opendispatch/ui/format';
import { useEffect, useRef, useState } from 'react';
import { Protocol } from 'pmtiles';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { DataSourceBadge } from '@/components/opendispatch/DataSourceBadge';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { cellBounds, cellFeatureCollection, type CellsView, type FxCell } from './cells';
import { basemapStyle, normalizeCssColor, zoneFeatureCollection } from './mapStyle';
import type { FxMapZone } from './view';
import styles from './ForecastExplorer.module.css';
import mirror from '@/components/opendispatch/mirror.module.css';

// Sub-zone demand map (#fx-map-host): a real basemap
// (MapLibre GL, a self-hosted pmtiles extract of
// Saudi Arabia, plan's Maps row), sub-zones drawn as
// a heat-coloured GeoJSON overlay at their real
// coordinates, the 15-min time control (prev, select
// of 96, next, "Peak"), and the low-to-high ramp
// legend. Scoped to this screen only: the shared
// schematic MapView is
// unchanged and still used everywhere else.

export interface DemandMapProps {
  readonly zones: readonly FxMapZone[];
  readonly time: number;
  readonly peakIndex: number;
  readonly label: string;
  /** The micro-cell layer; status off hides it. */
  readonly cells?: CellsView | undefined;
  readonly locale?: 'en' | 'ar' | undefined;
}

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => ({ value: String(i), label: `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}` }));
const RIYADH: [number, number] = [46.6753, 24.7136];
const FILL_LAYER = 'zones-fill';
const LINE_LAYER = 'zones-line';
const HEAT_TOKENS = ['--od-heat-1', '--od-heat-2', '--od-heat-3', '--od-heat-4', '--od-heat-5'] as const;
const CELL_FILL = 'cells-fill';
const CELL_LINE = 'cells-line';
const CELL_POOL = 'cells-pool';
const NO_CELLS: CellsView = { status: 'off' };

let protocolRegistered = false;
/**
 * Registers the `pmtiles://` protocol and points MapLibre at its own web worker bundle, copied to
 * public/maplibre/ from the installed maplibre-gl package (Turbopack and webpack both mis-bundle
 * MapLibre's dynamic `new Worker(new URL(...))` call, dropping the worker's sibling shared chunk;
 * copying the pair into public/ and pointing setWorkerUrl at it is the documented workaround).
 * Idempotent, browser only. Re-copy public/maplibre/*.mjs from node_modules/maplibre-gl/dist/ on
 * a maplibre-gl version bump.
 */
function ensurePmtilesProtocol(): void {
  if (protocolRegistered) return;
  setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
  addProtocol('pmtiles', new Protocol().tile);
  protocolRegistered = true;
}

/** Fits the view to every zone's coordinates, or Riyadh at a city-wide zoom when there are none. */
function fitToZones(map: MaplibreMap, zones: readonly FxMapZone[]): void {
  if (zones.length === 0) {
    map.jumpTo({ center: RIYADH, zoom: 9 });
    return;
  }
  const lats = zones.map((z) => z.lat);
  const lons = zones.map((z) => z.lon);
  map.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: 40, maxZoom: 13, duration: 0 },
  );
}

export function DemandMap({ zones, time, peakIndex, label, cells = NO_CELLS, locale = 'en' }: DemandMapProps) {
  const m = useTranslations('ops.forecast_explorer');
  const t = useTranslations();
  const tMap = useTranslations('opendispatch.map');
  const url = useUrlState();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const zonesRef = useRef(zones);
  const selectZoneRef = useRef<(code: string) => void>(() => {});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hovered, setHovered] = useState<string | null>(null);
  const cellsOn = cells.status !== 'off';

  const setTime = (next: number) => url.update({ time: String(((next % 96) + 96) % 96) });
  const selectZone = (code: string) => url.update({ sub: code === url.get('sub') ? null : code });

  useEffect(() => {
    zonesRef.current = zones;
  }, [zones]);
  useEffect(() => {
    selectZoneRef.current = selectZone;
  });

  // Create the map once. Basemap + zone-overlay layers and click handling are wired on 'load', reading the
  // latest zones and selectZone through refs so this effect never needs to re-run when the time slider moves.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    ensurePmtilesProtocol();
    setStatus('loading');
    const origin = window.location.origin;
    const map = new MaplibreMap({
      container,
      style: basemapStyle(`${origin}/maps/saudi.pmtiles`),
      center: RIYADH,
      zoom: 9,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    // A stalled load never fires 'error'; time out.
    const loadTimeout = window.setTimeout(() => setStatus((s) => (s === 'loading' ? 'error' : s)), 15000);

    map.on('error', () => {
      window.clearTimeout(loadTimeout);
      setStatus('error');
    });
    map.on('load', () => {
      window.clearTimeout(loadTimeout);
      const resolved = readTokens(['--od-heat-1', '--od-heat-2', '--od-heat-3', '--od-heat-4', '--od-heat-5', '--od-color-primary', '--od-color-border-control', '--od-color-border', '--od-color-text-secondary']);
      const heatColors = HEAT_TOKENS.map((name) => normalizeCssColor(resolved[name]));
      const activeColor = normalizeCssColor(resolved['--od-color-primary']);
      const strokeColor = normalizeCssColor(resolved['--od-color-border-control']);

      map.addSource('zones', { type: 'geojson', data: zoneFeatureCollection(zonesRef.current) });
      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: 'zones',
        paint: {
          'fill-color': ['match', ['get', 'heat'], 1, heatColors[0], 2, heatColors[1], 3, heatColors[2], 4, heatColors[3], 5, heatColors[4], heatColors[0]] as unknown as string,
          'fill-opacity': 0.92,
        },
      });
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': ['case', ['==', ['get', 'active'], 1] as unknown as boolean, activeColor, strokeColor] as unknown as string,
          'line-width': ['case', ['==', ['get', 'active'], 1] as unknown as boolean, 2, 1] as unknown as number,
        },
      });

      const cellEdge = normalizeCssColor(resolved['--od-color-border']);
      const poolEdge = normalizeCssColor(resolved['--od-color-text-secondary']);
      map.addSource('cells', { type: 'geojson', data: cellFeatureCollection([]) });
      map.addLayer({
        id: CELL_FILL,
        type: 'fill',
        source: 'cells',
        filter: ['==', ['get', 'pooled'], 0],
        paint: {
          'fill-color': ['match', ['get', 'level'], 1, heatColors[0], 2, heatColors[1], 3, heatColors[2], 4, heatColors[3], 5, heatColors[4], heatColors[0]] as unknown as string,
          'fill-opacity': 0.9,
        },
      });
      map.addLayer({ id: CELL_LINE, type: 'line', source: 'cells', filter: ['==', ['get', 'pooled'], 0], paint: { 'line-color': cellEdge, 'line-width': 0.5 } });
      map.addLayer({ id: CELL_POOL, type: 'line', source: 'cells', filter: ['==', ['get', 'pooled'], 1], paint: { 'line-color': poolEdge, 'line-width': 1, 'line-dasharray': [4, 3] } });
      map.on('mousemove', CELL_FILL, (e: MapLayerMouseEvent) => {
        setHovered((e.features?.[0]?.properties?.['id'] as string | undefined) ?? null);
      });
      map.on('mouseleave', CELL_FILL, () => setHovered(null));

      map.on('click', FILL_LAYER, (e: MapLayerMouseEvent) => {
        const code = e.features?.[0]?.properties?.['code'] as string | undefined;
        if (code !== undefined) selectZoneRef.current(code);
      });
      map.on('mouseenter', FILL_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', FILL_LAYER, () => {
        map.getCanvas().style.cursor = '';
      });

      fitToZones(map, zonesRef.current);
      setStatus('ready');
    });

    return () => {
      window.clearTimeout(loadTimeout);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Zone identities changed (city/zone/sub picked, not just the time slider): refresh the overlay and refit.
  // Reads zones through the ref (not the `zones` prop directly) so this effect depends only on which zones are
  // shown (zoneKey), not on a new array reference every time the time slider changes their heat.
  const zoneKey = zones.map((z) => z.code).join(',');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    const source = map.getSource('zones') as GeoJSONSource | undefined;
    source?.setData(zoneFeatureCollection(zonesRef.current));
    fitToZones(map, zonesRef.current);
  }, [zoneKey, status]);

  // Heat/active values changed without the zone set changing (a new time index): update the overlay data only.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    const source = map.getSource('zones') as GeoJSONSource | undefined;
    source?.setData(zoneFeatureCollection(zones));
  }, [zones, status]);

  // Cell layer: data, dimmed zones, fit.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    const list = cells.status === 'filled' ? cells.cells : [];
    (map.getSource('cells') as GeoJSONSource | undefined)?.setData(cellFeatureCollection(list));
    map.setPaintProperty(FILL_LAYER, 'fill-opacity', cellsOn ? 0.08 : 0.92);
    const box = cellBounds(list);
    if (box !== null) map.fitBounds(box, { padding: 32, maxZoom: 16, duration: 0 });
    else fitToZones(map, zonesRef.current);
  }, [cells, cellsOn, status]);

  const filled = cells.status === 'filled' ? cells : null;
  const shown: FxCell | undefined = filled === null ? undefined : (filled.cells.find((c) => c.id === hovered) ?? filled.cells[0]);
  const tipOf = (c: FxCell, of: number) =>
    `${c.pooled ? `${m('cells.pool')} · ` : ''}${m('cells.tip', { pct: `${num(c.probability * 100, 1, locale)}%`, n: num(c.probability * of, 1, locale), of: num(of, 1, locale) })}`;

  return (
    <div className={styles.mapCard}>
      <div className={styles.mapLibreFrame} data-state={status}>
        <div ref={containerRef} className={styles.mapLibrePlot} dir="ltr" role="img" aria-label={label} />
        {status === 'loading' ? (
          <div className={styles.mapLibreState} aria-hidden="true">
            <Skeleton width="100%" height="100%" radius="lg" />
          </div>
        ) : null}
        {status === 'error' ? (
          <div className={styles.mapLibreState}>
            <EmptyState tone="danger" compact title={tMap('error')} icon={<MapPinOff />} />
          </div>
        ) : null}
        <p className={styles.srOnly}>{m('map.summary', { count: zones.length })}</p>
        {filled === null ? null : (
          <ul className={styles.srOnly} aria-label={m('cells.share')}>
            {filled.cells.map((c) => (
              <li key={c.id}>{tipOf(c, filled.hourExpected)}</li>
            ))}
          </ul>
        )}
        <ul className={styles.srOnly} aria-label={tMap('zones')}>
          {zones.map((zone) => (
            <li key={zone.code}>
              <button type="button" onClick={() => selectZone(zone.code)} aria-pressed={zone.active}>
                {zone.label}: {tMap('level', { level: zone.heat })}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {cellsOn ? (
        <div className={styles.cellsLine} aria-live="polite">
          {url.pending ? (
            <Skeleton width={240} height={14} announce />
          ) : cells.status === 'empty' ? (
            <>
              <MapIcon className={styles.cellsIcon} aria-hidden="true" />
              <span>{m('cells.empty')}</span>
            </>
          ) : cells.status === 'error' ? (
            <>
              <TriangleAlert className={styles.cellsIcon} aria-hidden="true" />
              <span>{m('cells.error')}</span>
            </>
          ) : filled !== null && shown !== undefined ? (
            <>
              <DataSourceBadge sources={[filled.source]} />
              <span>{m('cells.share')}</span>
              <span className={styles.rampBar} aria-hidden="true">
                {[1, 2, 3, 4, 5].map((level) => (
                  <span key={level} className={styles.rampSwatch} data-heat={level} />
                ))}
              </span>
              <span translate="no">{hovered === null ? m('cells.top', { tip: tipOf(shown, filled.hourExpected) }) : tipOf(shown, filled.hourExpected)}</span>
              <IllustrativeLabel />
            </>
          ) : null}
        </div>
      ) : null}
      <div className={styles.mapControls}>
        <div className={styles.timeGroup}>
          <IconButton variant="secondary" size="sm" icon={<ChevronLeft className={mirror.mirror} />} label={t('common.previous')} onClick={() => setTime(time - 1)} />
          <Select width="auto" size="sm" aria-label={m('time')} value={String(time)} options={TIME_OPTIONS} onChange={(event) => setTime(Number(event.target.value))} />
          <IconButton variant="secondary" size="sm" icon={<ChevronRight className={mirror.mirror} />} label={t('common.next')} onClick={() => setTime(time + 1)} />
          <Button variant="ghost" size="sm" startIcon={<Crosshair />} onClick={() => setTime(peakIndex)}>
            {m('peak')}
          </Button>
        </div>
        {cellsOn ? null : (
        <div className={styles.ramp}>
          <span>{m('ramp.low')}</span>
          <span className={styles.rampBar} aria-hidden="true">
            {[1, 2, 3, 4, 5].map((level) => (
              <span key={level} className={styles.rampSwatch} data-heat={level} />
            ))}
          </span>
          <span>{m('ramp.high')}</span>
        </div>
        )}
      </div>
    </div>
  );
}
