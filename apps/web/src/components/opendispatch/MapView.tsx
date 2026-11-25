'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, EmptyState, IconButton, Skeleton } from '@opendispatch/ui';
import { int } from '@opendispatch/ui/format';
import { MapPinOff, Maximize, Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { LiveStage, AgentLiveStatus } from '@/lib/types';
import { cx } from './cx';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  clampZoom,
  extentOf,
  fittingLabels,
  isCoordinate,
  mainGroupMask,
  projectionFor,
  roads,
  round,
  spreadPoints,
  zoneOutline,
  zoneRadius,
  zoneReach,
  type Reach,
} from './map-geometry';
import { StatusDot } from './StatusDot';
import styles from './MapView.module.css';

// A schematic map: zone outlines, pins, links and a legend on a plain canvas, drawn as SVG. No tiles, no network, no map
// library. The props are all geographic (latitude, longitude, kilometres), and nothing in them
// is SVG, so a MapLibre map with a self-hosted map file can replace this one later without changing a caller.
//
// Left to right always: the plot never flips in Arabic, like every time axis and chart plot. The controls, the legend
// and the note sit outside the plot and follow the page direction.

/** A zone's look: a live-assignment stage, or a coverage state. `none` draws nothing (a frame that only sets the view). */
export type MapZoneStage = LiveStage | 'gap' | 'surplus' | 'none';
/** Demand or another quantity in five steps, drawn with the design system's heat ramp. */
export type MapHeat = 1 | 2 | 3 | 4 | 5;
/** A pin is an agent (by live status), a case, a standby point or a suggested waiting spot. */
export type MapPinKind = AgentLiveStatus | 'case' | 'standby' | 'spot';

export interface MapZone {
  /** The zone or sub-zone code, from the data. Also its name for assistive technology. */
  code: string;
  lat: number;
  lon: number;
  radiusKm: number;
  /** Stage or coverage state. Ignored while `heat` is set. */
  stage?: MapZoneStage | undefined;
  /** Fills the zone from the heat ramp instead of by stage. */
  heat?: MapHeat | undefined;
  /** Text drawn on the zone. Default: the code. A blank string draws none. */
  label?: string | undefined;
  /** The chosen zone: a heavier outline. */
  active?: boolean | undefined;
}

export interface MapPin {
  id: string;
  lat: number;
  lon: number;
  kind: MapPinKind;
  /** The name of the agent, case or point. Also its name for assistive technology. */
  label: string;
  selected?: boolean | undefined;
}

/** A dashed line between two places, for example an agent and the case they are on their way to. */
export interface MapLink {
  from: readonly [lat: number, lon: number];
  to: readonly [lat: number, lon: number];
  /** `suggestion`: an arrow to a suggested waiting spot. Default: a route. */
  kind?: 'route' | 'suggestion' | undefined;
}

/** A coverage circle around a standby point. */
export interface MapCover {
  lat: number;
  lon: number;
  radiusKm: number;
}

export interface MapLegendItem {
  /** The pin kind this entry explains. */
  dot?: MapPinKind | undefined;
  /** Already in the reader's language. */
  label: string;
}

export interface MapSelection {
  kind: 'zone' | 'pin';
  /** The zone code or the pin id. */
  id: string;
}

export interface MapViewProps {
  zones?: readonly MapZone[] | undefined;
  pins?: readonly MapPin[] | undefined;
  links?: readonly MapLink[] | undefined;
  cover?: readonly MapCover[] | undefined;
  legend?: readonly MapLegendItem[] | undefined;
  /** Height of the frame in pixels, at least 280. Default 360. */
  height?: number | undefined;
  /** The name of the map for assistive technology, for example "Coverage". Default: "Schematic map". */
  label?: string | undefined;
  /** loading: a skeleton. error: the error state (with a retry when `onRetry` is given). Default ready. */
  state?: 'ready' | 'loading' | 'error' | undefined;
  onRetry?: (() => void) | undefined;
  /**
   * Makes zones and pins buttons: keyboard reachable (one tab stop, arrow keys between them), and Enter, Space or a
   * click calls this with what was chosen. Without it the map is a picture with a text alternative.
   */
  onSelect?: ((selection: MapSelection) => void) | undefined;
  /** `main`: fit the biggest group of places that lie close together (one city) and say how many are left out. */
  fit?: 'all' | 'main' | undefined;
}

const DEFAULT_HEIGHT = 360;
/** The width used until the frame has been measured (server render, and tests without layout). */
const DEFAULT_WIDTH = 640;
/** Narrower than this is a layout still settling, not a real size. */
const MIN_MEASURED_WIDTH = 40;
const PIN_RADIUS = 6;
const CASE_RADIUS = 8;
const HIT_RADIUS = 14;
const RING_GAP = 4;
/** The room a pin takes, so two that meet are spread apart. */
const PIN_SPACING = 2 * CASE_RADIUS + 2;
/** A zone label's size, for dropping the ones that would overlap. */
const LABEL_CHAR_PX = 7.5;
const LABEL_HEIGHT_PX = 16;

const PIN_CLASS: Readonly<Record<MapPinKind, string | undefined>> = {
  available: styles.available,
  assigned: styles.assigned,
  en_route: styles.enRoute,
  on_scene: styles.onScene,
  on_break: styles.onBreak,
  offline: styles.offline,
  case: styles.caseKind,
  standby: styles.standby,
  spot: styles.spot,
};

const ZONE_CLASS: Readonly<Record<Exclude<MapZoneStage, 'none'>, string | undefined>> = {
  shadow: styles.shadow,
  recommend: styles.recommend,
  automatic: styles.automatic,
  gap: styles.gap,
  surplus: styles.surplus,
};

const HEAT_CLASS: Readonly<Record<MapHeat, string | undefined>> = {
  1: styles.heat1,
  2: styles.heat2,
  3: styles.heat3,
  4: styles.heat4,
  5: styles.heat5,
};

function zoneClass(zone: MapZone): string | undefined {
  if (zone.heat !== undefined) return HEAT_CLASS[zone.heat];
  const stage = zone.stage;
  return stage === undefined || stage === 'none' ? ZONE_CLASS.shadow : ZONE_CLASS[stage];
}

const STATUS_KINDS: readonly string[] = ['available', 'assigned', 'en_route', 'on_scene', 'on_break', 'offline'];

/** The width of the frame, kept up to date. Until it is measured (and where there is no layout) it is DEFAULT_WIDTH. */
function useFrameWidth(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    const read = () => {
      const measured = Math.floor(element.clientWidth);
      if (measured >= MIN_MEASURED_WIDTH) setWidth(measured);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  return { ref, width };
}

interface ItemProps {
  itemKey: string;
  name: string;
  className?: string | undefined;
  /** False: a picture only, not focusable and not a button. */
  interactive: boolean;
  pressed: boolean;
  tabStop: boolean;
  onActivate: () => void;
  onFocusItem: (key: string) => void;
  register: (key: string, element: SVGGElement | null) => void;
  children: ReactNode;
}

/** One zone or pin: a button when the map is interactive, otherwise plain graphics with a native tooltip. */
function Item({ itemKey, name, className, interactive, pressed, tabStop, onActivate, onFocusItem, register, children }: ItemProps) {
  if (!interactive) return <g className={className}>{children}</g>;
  return (
    <g
      ref={(element) => register(itemKey, element)}
      className={cx(styles.item, className)}
      role="button"
      tabIndex={tabStop ? 0 : -1}
      aria-label={name}
      aria-pressed={pressed}
      data-map-item={itemKey}
      onClick={onActivate}
      onFocus={() => onFocusItem(itemKey)}
    >
      {children}
    </g>
  );
}

export function MapView({
  zones = [],
  pins = [],
  links = [],
  cover = [],
  legend = [],
  height = DEFAULT_HEIGHT,
  label,
  state = 'ready',
  onRetry,
  onSelect,
  fit = 'all',
}: MapViewProps) {
  const t = useTranslations('opendispatch.map');
  const tStage = useTranslations('opendispatch.stage');
  const tStatus = useTranslations('opendispatch.status');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const summaryId = useId();
  const arrowId = `map-${summaryId.replace(/[^A-Za-z0-9_-]/g, '')}-arrow`;

  // Everything that has a place; with fit `main` only one city's worth of it is kept.
  const scoped = useMemo(() => {
    const zoneList = zones.filter((zone) => isCoordinate(zone.lat, zone.lon));
    const pinList = pins.filter((pin) => isCoordinate(pin.lat, pin.lon));
    const coverList = cover.filter((c) => isCoordinate(c.lat, c.lon));
    const linkList = links.filter((link) => isCoordinate(link.from[0], link.from[1]) && isCoordinate(link.to[0], link.to[1]));
    if (fit !== 'main') return { zoneList, pinList, coverList, linkList, outside: 0 };
    const points = [
      ...zoneList,
      ...pinList,
      ...coverList,
      ...linkList.map((link) => ({ lat: link.from[0], lon: link.from[1] })),
    ];
    const mask = mainGroupMask(points);
    let at = 0;
    const keep = <T,>(list: readonly T[]) => list.filter(() => mask[at++] === true);
    const keptZones = keep(zoneList);
    const keptPins = keep(pinList);
    const keptCover = keep(coverList);
    const keptLinks = keep(linkList);
    return { zoneList: keptZones, pinList: keptPins, coverList: keptCover, linkList: keptLinks, outside: pinList.length - keptPins.length };
  }, [zones, pins, cover, links, fit]);

  const drawnZones = useMemo(() => scoped.zoneList.filter((zone) => zone.stage !== 'none'), [scoped]);
  // A hidden zone (`none`) still sets the view, so it counts for the bounds but is not drawn or listed.
  const boundsZones = scoped.zoneList;
  const drawnPins = scoped.pinList;
  const drawnCover = scoped.coverList;
  const drawnLinks = scoped.linkList;

  const mode = state !== 'ready' ? state : boundsZones.length === 0 && drawnPins.length === 0 ? 'empty' : 'filled';
  const { ref, width } = useFrameWidth(mode === 'filled');
  const [zoom, setZoom] = useState(1);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const elements = useRef(new Map<string, SVGGElement>());

  const interactive = onSelect !== undefined;
  const name = label ?? t('label');

  const geometry = useMemo(() => {
    const reach: Reach[] = [
      ...boundsZones.map((zone) => ({ lat: zone.lat, lon: zone.lon, radiusKm: zoneReach(zone.radiusKm) })),
      ...drawnPins.map((pin) => ({ lat: pin.lat, lon: pin.lon })),
      ...drawnCover.map((c) => ({ lat: c.lat, lon: c.lon, radiusKm: c.radiusKm })),
      ...drawnLinks.flatMap((link) => [
        { lat: link.from[0], lon: link.from[1] },
        { lat: link.to[0], lon: link.to[1] },
      ]),
    ];
    const extent = extentOf(reach);
    return extent ? projectionFor(extent, width, height, zoom) : null;
  }, [boundsZones, drawnPins, drawnCover, drawnLinks, width, height, zoom]);

  const zoneState = (zone: MapZone): string => {
    if (zone.heat !== undefined) return t('level', { level: zone.heat });
    if (zone.stage === 'gap' || zone.stage === 'surplus') return t(`zone.${zone.stage}`);
    if (zone.stage === 'shadow' || zone.stage === 'recommend' || zone.stage === 'automatic') return tStage(zone.stage);
    return '';
  };
  const kindName = (kind: MapPinKind): string => (STATUS_KINDS.includes(kind) ? tStatus(kind) : t(`kind.${kind}`));
  const zoneName = (zone: MapZone): string => {
    const stateText = zoneState(zone);
    return stateText === '' ? zone.code : `${zone.code}: ${stateText}`;
  };
  const pinName = (pin: MapPin): string => `${pin.label}: ${kindName(pin.kind)}`;

  // What each item selects, in the order the keyboard walks them: zones first, then pins.
  const items = useMemo(() => {
    const list: { key: string; selection: MapSelection }[] = [];
    for (const zone of drawnZones) list.push({ key: `zone:${zone.code}`, selection: { kind: 'zone', id: zone.code } });
    for (const pin of drawnPins) list.push({ key: `pin:${pin.id}`, selection: { kind: 'pin', id: pin.id } });
    return list;
  }, [drawnZones, drawnPins]);
  const firstKey = items[0]?.key ?? null;
  // One tab stop for the whole map (a roving tabindex); it stays on the last item that had focus.
  const tabKey = focusKey !== null && items.some((item) => item.key === focusKey) ? focusKey : firstKey;

  const register = (key: string, element: SVGGElement | null) => {
    if (element) elements.current.set(key, element);
    else elements.current.delete(key);
  };
  const focusItem = (key: string | undefined) => {
    if (key === undefined) return;
    setFocusKey(key);
    elements.current.get(key)?.focus();
  };

  const onPlotKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!onSelect || !(event.target instanceof Element)) return;
    const key = event.target.closest('[data-map-item]')?.getAttribute('data-map-item');
    if (key === null || key === undefined) return;
    const index = items.findIndex((item) => item.key === key);
    const entry = items[index];
    if (!entry) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(entry.selection);
      return;
    }
    // The plot is always left to right, so the arrows mean the same in both languages.
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      focusItem(items[(index + step + items.length) % items.length]?.key);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(items[0]?.key);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(items[items.length - 1]?.key);
    }
  };

  const zoomBy = (delta: number) => setZoom((current) => clampZoom(Math.round((current + delta) / ZOOM_STEP) * ZOOM_STEP));
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
    else if (event.key === '-' || event.key === '_') zoomBy(-ZOOM_STEP);
    else if (event.key === '0') setZoom(1);
  };

  const frame = { blockSize: height };

  if (mode === 'loading') {
    return (
      <div ref={ref} className={styles.root} style={frame} data-state="loading" role="status" aria-busy="true">
        <span className={styles.srOnly}>{tCommon('loading')}</span>
        <div className={styles.state} aria-hidden="true">
          <Skeleton width="100%" height="100%" radius="lg" />
        </div>
      </div>
    );
  }

  if (mode === 'error') {
    return (
      <div ref={ref} className={styles.root} style={frame} data-state="error">
        <div className={styles.state}>
          <EmptyState
            tone="danger"
            compact
            title={t('error')}
            action={onRetry ? <Button onClick={onRetry}>{tCommon('retry')}</Button> : undefined}
          />
        </div>
      </div>
    );
  }

  if (mode === 'empty' || geometry === null) {
    return (
      <div ref={ref} className={styles.root} style={frame} data-state="empty">
        <div className={styles.state}>
          <EmptyState compact icon={<MapPinOff />} title={t('empty')} />
        </div>
      </div>
    );
  }

  const projection = geometry;
  const placed = new Map(spreadPoints(drawnPins.map((pin) => ({ id: pin.id, x: projection.x(pin.lon), y: projection.y(pin.lat) })), PIN_SPACING).map((point) => [point.id, point] as const));
  const labelBoxes = [...drawnZones]
    .sort((a, b) => Number(b.active === true) - Number(a.active === true))
    .flatMap((zone) => {
      const text = (zone.label ?? zone.code).trim();
      if (text === '') return [];
      return [{ key: zone.code, x: projection.x(zone.lon), y: round(projection.y(zone.lat) - zoneRadius(projection, zone.radiusKm) * 0.55), width: text.length * LABEL_CHAR_PX, height: LABEL_HEIGHT_PX }];
    });
  const shownLabels = fittingLabels(labelBoxes);
  const atMaxZoom = zoom >= MAX_ZOOM;
  const atMinZoom = zoom <= MIN_ZOOM;
  const zoomProps = (delta: number, at: boolean) => ({
    'aria-disabled': at ? true : undefined,
    onClick: () => {
      if (!at) zoomBy(delta);
    },
  });

  return (
    <div ref={ref} className={styles.root} style={frame} data-state="filled" onKeyDown={onRootKeyDown}>
      {/* The plot is a picture of data: zone codes and the names of agents, cases and points. A browser's translator must leave them alone. */}
      <div className={styles.plot} dir="ltr" translate="no" data-map-plot="">
        <svg
          className={styles.svg}
          viewBox={`0 0 ${width} ${height}`}
          role={interactive ? 'group' : 'img'}
          aria-label={name}
          aria-describedby={summaryId}
          onKeyDown={onPlotKeyDown}
        >
          <g aria-hidden="true">
            {roads(width, height, zoom).map((road, index) => (
              <path key={index} className={cx(styles.road, road.minor && styles.minor)} d={road.d} />
            ))}
          </g>

          {drawnZones.map((zone) => {
            const key = `zone:${zone.code}`;
            const cx0 = projection.x(zone.lon);
            const cy0 = projection.y(zone.lat);
            const radius = zoneRadius(projection, zone.radiusKm);
            const stageClass = zoneClass(zone);
            const text = zone.label ?? zone.code;
            return (
              <Item
                key={key}
                itemKey={key}
                name={zoneName(zone)}
                interactive={interactive}
                pressed={zone.active === true}
                tabStop={tabKey === key}
                onActivate={() => onSelect?.({ kind: 'zone', id: zone.code })}
                onFocusItem={setFocusKey}
                register={register}
              >
                <path
                  className={cx(styles.zone, stageClass, zone.active && styles.active)}
                  d={zoneOutline(zone.code, cx0, cy0, radius)}
                  data-zone={zone.code}
                />
                {text.trim() === '' || !shownLabels.has(zone.code) ? null : (
                  <text className={styles.label} x={cx0} y={round(cy0 - radius * 0.55)}>
                    {text}
                  </text>
                )}
                <title>{zoneName(zone)}</title>
              </Item>
            );
          })}

          {drawnCover.map((c, index) => (
            <circle key={index} className={styles.cover} cx={projection.x(c.lon)} cy={projection.y(c.lat)} r={projection.km(c.radiusKm)} />
          ))}

          {drawnLinks.some((link) => link.kind === 'suggestion') ? (
            <defs>
              <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path className={styles.arrow} d="M0 0L8 4L0 8Z" />
              </marker>
            </defs>
          ) : null}
          {drawnLinks.map((link, index) => (
            <path
              key={index}
              className={cx(styles.link, link.kind === 'suggestion' && styles.suggestion)}
              d={`M${projection.x(link.from[1])} ${projection.y(link.from[0])}L${projection.x(link.to[1])} ${projection.y(link.to[0])}`}
              markerEnd={link.kind === 'suggestion' ? `url(#${arrowId})` : undefined}
            />
          ))}

          {drawnPins.map((pin) => {
            const key = `pin:${pin.id}`;
            const px = placed.get(pin.id)?.x ?? projection.x(pin.lon);
            const py = placed.get(pin.id)?.y ?? projection.y(pin.lat);
            const radius = pin.kind === 'case' ? CASE_RADIUS : PIN_RADIUS;
            return (
              <Item
                key={key}
                itemKey={key}
                name={pinName(pin)}
                interactive={interactive}
                pressed={pin.selected === true}
                tabStop={tabKey === key}
                onActivate={() => onSelect?.({ kind: 'pin', id: pin.id })}
                onFocusItem={setFocusKey}
                register={register}
              >
                {interactive ? <circle className={styles.hit} cx={px} cy={py} r={HIT_RADIUS} /> : null}
                {interactive ? <circle className={styles.ring} cx={px} cy={py} r={radius + RING_GAP} /> : null}
                <circle
                  className={cx(styles.pin, PIN_CLASS[pin.kind], pin.selected && styles.selected)}
                  cx={px}
                  cy={py}
                  r={radius}
                  data-pin={pin.id}
                />
                <title>{pin.label}</title>
              </Item>
            );
          })}
        </svg>
      </div>

      <div className={styles.controls}>
        <IconButton
          variant="secondary"
          size="sm"
          icon={<Plus />}
          label={t('zoomIn')}
          {...zoomProps(ZOOM_STEP, atMaxZoom)}
        />
        <IconButton
          variant="secondary"
          size="sm"
          icon={<Minus />}
          label={t('zoomOut')}
          {...zoomProps(-ZOOM_STEP, atMinZoom)}
        />
        <IconButton
          variant="secondary"
          size="sm"
          icon={<Maximize />}
          label={t('reset')}
          aria-disabled={zoom === 1 ? true : undefined}
          onClick={() => setZoom(1)}
        />
      </div>

      {legend.length > 0 ? (
        <ul className={styles.legend}>
          {legend.map((item, index) => (
            <li key={`${index}:${item.label}`} className={styles.legendItem}>
              {item.dot ? <LegendSwatch kind={item.dot} /> : null}
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      <p className={styles.note}>{scoped.outside > 0 ? t('outside', { n: int(scoped.outside, locale) }) : t('label')}</p>

      {/* The text alternative: what the picture shows. The buttons carry their own names when the map is interactive. */}
      <div className={styles.srOnly} id={summaryId}>
        <p>{t('summary', { zones: int(drawnZones.length, locale), pins: int(drawnPins.length, locale) })}</p>
        {interactive ? null : (
          <>
            {drawnZones.length > 0 ? (
              <ul aria-label={t('zones')}>
                {drawnZones.map((zone) => (
                  <li key={zone.code} translate="no">
                    {zoneName(zone)}
                  </li>
                ))}
              </ul>
            ) : null}
            {drawnPins.length > 0 ? (
              <ul aria-label={t('points')}>
                {drawnPins.map((pin) => (
                  <li key={pin.id} translate="no">
                    {pinName(pin)}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function LegendSwatch({ kind }: { kind: MapPinKind }) {
  if (kind === 'case') return <i className={cx(styles.swatch, styles.swatchCase)} aria-hidden="true" />;
  if (kind === 'standby') return <i className={cx(styles.swatch, styles.swatchStandby)} aria-hidden="true" />;
  if (kind === 'spot') return <i className={cx(styles.swatch, styles.swatchSpot)} aria-hidden="true" />;
  return <StatusDot status={kind} decorative />;
}
