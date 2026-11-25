// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapView, type MapPin, type MapViewProps, type MapZone } from './MapView';
import { hasArabicIndicDigits, hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ZONES: MapZone[] = [
  { code: 'RD-C', lat: 24.71, lon: 46.68, radiusKm: 6, stage: 'recommend' },
  { code: 'RD-E', lat: 24.71, lon: 46.7987, radiusKm: 6.5, stage: 'shadow' },
  { code: 'RD-W', lat: 24.71, lon: 46.5613, radiusKm: 6.5, heat: 4 },
];
const PINS: MapPin[] = [
  { id: 'SVR-1', lat: 24.7, lon: 46.68, kind: 'available', label: 'Sara Al-Habuli' },
  { id: 'SVR-2', lat: 24.72, lon: 46.79, kind: 'en_route', label: 'Adel Al-Ghaari' },
  { id: 'CASE-30', lat: 24.73, lon: 46.7, kind: 'case', label: 'RD-260913-00230' },
  { id: 'SB-1', lat: 24.69, lon: 46.74, kind: 'standby', label: 'Olaya standby', selected: true },
];
const DATA_VALUES = ['RD-C', 'RD-E', 'RD-W', 'Sara Al-Habuli', 'Adel Al-Ghaari', 'RD-260913-00230', 'Olaya standby'];

function renderMap(props: Partial<MapViewProps> = {}, locale: 'en' | 'ar' = 'en') {
  return inLocale(locale, <MapView zones={ZONES} pins={PINS} {...props} />);
}

const pin = (container: Element, id: string) => container.querySelector(`circle[data-pin="${id}"]`);
const num = (element: Element | null, attribute: string) => Number(element?.getAttribute(attribute));
const items = (container: Element) => [...container.querySelectorAll('[data-map-item]')] as SVGGElement[];

describe('MapView: filled', () => {
  it('draws every zone and pin on a labelled svg, with the note that it is schematic', () => {
    const { container } = renderMap({ label: 'Coverage' });
    expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('filled');
    expect(screen.getByRole('img', { name: 'Coverage' })).toBeTruthy();
    expect(container.querySelectorAll('path[data-zone]')).toHaveLength(3);
    expect(container.querySelectorAll('circle[data-pin]')).toHaveLength(4);
    expect(screen.getByText('Schematic map')).toBeTruthy();
  });

  it('with fit "main" shows one city, says how many are left out, and spreads coincident pins', () => {
    const far: MapPin[] = [
      { id: 'JED-1', lat: 21.54, lon: 39.17, kind: 'available', label: 'Jeddah agent' },
      { id: 'JED-2', lat: 21.55, lon: 39.18, kind: 'available', label: 'Jeddah two' },
    ];
    const same: MapPin[] = [
      { id: 'SVR-A', lat: 24.7, lon: 46.68, kind: 'available', label: 'A' },
      { id: 'SVR-B', lat: 24.7, lon: 46.68, kind: 'available', label: 'B' },
    ];
    const { container } = renderMap({ fit: 'main', pins: [...PINS, ...far, ...same] });
    expect(pin(container, 'JED-1')).toBeNull();
    expect(pin(container, 'SVR-1')).not.toBeNull();
    expect(screen.getByText('2 more in other cities, not shown')).toBeTruthy();
    const a = pin(container, 'SVR-A');
    const b = pin(container, 'SVR-B');
    expect(Math.hypot(num(a, 'cx') - num(b, 'cx'), num(a, 'cy') - num(b, 'cy'))).toBeGreaterThanOrEqual(16);
  });

  it('is called "Schematic map" when no name is given', () => {
    renderMap();
    expect(screen.getByRole('img', { name: 'Schematic map' })).toBeTruthy();
  });

  it('is a text alternative for screen readers: a summary and a list of zones and of points', () => {
    const { container } = renderMap();
    const svg = screen.getByRole('img');
    const described = container.querySelector(`[id="${svg.getAttribute('aria-describedby')}"]`);
    expect(described?.textContent).toContain('Zones: 3, points: 4');
    const zones = within(screen.getByRole('list', { name: 'Zones' })).getAllByRole('listitem');
    expect(zones.map((node) => node.textContent)).toEqual(['RD-C: Recommend', 'RD-E: Shadow', 'RD-W: Level 4 of 5']);
    const points = within(screen.getByRole('list', { name: 'Points' })).getAllByRole('listitem');
    expect(points.map((node) => node.textContent)).toEqual([
      'Sara Al-Habuli: Available',
      'Adel Al-Ghaari: En route',
      'RD-260913-00230: Case',
      'Olaya standby: Standby point',
    ]);
  });

  it('names gap and surplus zones, and draws no hidden (`none`) zone', () => {
    const { container } = renderMap({
      zones: [
        { code: 'FRAME', lat: 24.71, lon: 46.68, radiusKm: 9, stage: 'none' },
        { code: 'RD-C-01', lat: 24.71, lon: 46.68, radiusKm: 1.6, stage: 'gap' },
        { code: 'RD-C-02', lat: 24.72, lon: 46.7, radiusKm: 1.6, stage: 'surplus' },
        { code: 'RD-C-03', lat: 24.7, lon: 46.66, radiusKm: 1.6 },
      ],
      pins: [],
    });
    expect([...container.querySelectorAll('path[data-zone]')].map((node) => node.getAttribute('data-zone'))).toEqual(['RD-C-01', 'RD-C-02', 'RD-C-03']);
    const zones = within(screen.getByRole('list', { name: 'Zones' })).getAllByRole('listitem');
    expect(zones.map((node) => node.textContent)).toEqual(['RD-C-01: Gap', 'RD-C-02: Surplus', 'RD-C-03']);
    expect(screen.queryByRole('list', { name: 'Points' })).toBeNull();
  });

  it('draws the label on a zone: its code, its own text, or none for a blank one', () => {
    const { container } = renderMap({
      zones: [
        { code: 'RD-C', lat: 24.71, lon: 46.68, radiusKm: 6 },
        { code: 'RD-C-01', label: '01', lat: 24.72, lon: 46.7, radiusKm: 1.6 },
        { code: 'RD-C-02', label: ' ', lat: 24.7, lon: 46.66, radiusKm: 1.6 },
      ],
      pins: [],
    });
    expect([...container.querySelectorAll('text')].map((node) => node.textContent)).toEqual(['RD-C', '01']);
  });

  it('skips a zone, pin, link or coverage circle with an impossible coordinate instead of failing', () => {
    const { container } = renderMap({
      zones: [...ZONES, { code: 'BAD', lat: Number.NaN, lon: 46, radiusKm: 3 }],
      pins: [...PINS, { id: 'BAD', lat: 200, lon: 46, kind: 'case', label: 'Bad' }],
      links: [{ from: [Number.NaN, 1], to: [24.7, 46.7] }],
      cover: [{ lat: Number.NaN, lon: 1, radiusKm: 1 }],
    });
    expect(container.querySelectorAll('path[data-zone]')).toHaveLength(3);
    expect(container.querySelectorAll('circle[data-pin]')).toHaveLength(4);
    expect(container.querySelectorAll('circle[class*="cover"]')).toHaveLength(0);
  });

  it('puts east to the right and north up, and keeps every pin inside the frame', () => {
    const { container } = renderMap({ height: 360 });
    const west = pin(container, 'SVR-1');
    const east = pin(container, 'SVR-2');
    expect(num(east, 'cx')).toBeGreaterThan(num(west, 'cx'));
    expect(num(pin(container, 'CASE-30'), 'cy')).toBeLessThan(num(west, 'cy'));
    for (const element of container.querySelectorAll('circle[data-pin]')) {
      expect(num(element, 'cx')).toBeGreaterThan(0);
      expect(num(element, 'cx')).toBeLessThan(640);
      expect(num(element, 'cy')).toBeGreaterThan(0);
      expect(num(element, 'cy')).toBeLessThan(360);
    }
  });

  it('draws links and coverage circles', () => {
    const { container } = renderMap({
      links: [{ from: [24.7, 46.68], to: [24.73, 46.7] }],
      cover: [{ lat: 24.69, lon: 46.74, radiusKm: 3 }],
    });
    expect(container.querySelectorAll('path[class*="link"]')).toHaveLength(1);
    expect(container.querySelectorAll('circle[class*="cover"]')).toHaveLength(1);
  });

  it('draws a suggestion as an arrow and a waiting spot as its own pin', () => {
    const { container } = renderMap({
      pins: [...PINS, { id: 'spot:SVR-1', lat: 24.72, lon: 46.69, kind: 'spot', label: 'Sara Al-Habuli' }],
      links: [
        { from: [24.7, 46.68], to: [24.72, 46.69], kind: 'suggestion' },
        { from: [24.72, 46.79], to: [24.73, 46.7] },
      ],
      legend: [{ dot: 'spot', label: 'Waiting spot' }],
    });
    const paths = [...container.querySelectorAll('path[class*="link"]')];
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute('class')).toMatch(/suggestion/);
    expect(paths[0]?.getAttribute('marker-end')).toMatch(/^url\(#.+-arrow\)$/);
    expect(paths[1]?.getAttribute('marker-end')).toBeNull();
    expect(container.querySelectorAll('marker')).toHaveLength(1);
    expect(pin(container, 'spot:SVR-1')?.getAttribute('class')).toMatch(/spot/);
    expect(container.querySelector('[class*="swatchSpot"]')).not.toBeNull();
  });

  it('has no arrow marker without a suggestion', () => {
    const { container } = renderMap({ links: [{ from: [24.7, 46.68], to: [24.73, 46.7] }] });
    expect(container.querySelectorAll('marker')).toHaveLength(0);
  });

  it('uses the given height, 360 by default', () => {
    const { container } = renderMap();
    const root = container.querySelector('[data-state]') as HTMLElement;
    expect(root.style.blockSize).toBe('360px');
    cleanup();
    const tall = renderMap({ height: 440 });
    expect((tall.container.querySelector('[data-state]') as HTMLElement).style.blockSize).toBe('440px');
    expect(tall.container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 640 440');
  });

  it('fits itself to the measured width and follows it when it changes', () => {
    let notify: () => void = () => undefined;
    class FakeObserver {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeObserver);
    let width = 900;
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
    try {
      const { container } = renderMap();
      expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 900 360');
      width = 500;
      act(() => notify());
      expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 500 360');
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }
  });
});

describe('MapView: legend', () => {
  const legend = [
    { dot: 'available', label: 'Available' },
    { dot: 'en_route', label: 'En route' },
    { dot: 'case', label: 'Case' },
    { dot: 'standby', label: 'Standby point' },
    { label: 'Coverage radius' },
  ] as const;

  it('lists each entry with its swatch (hidden from assistive technology)', () => {
    renderMap({ legend });
    const list = screen.getAllByRole('list').find((node) => node.textContent?.includes('Coverage radius'));
    expect(list).toBeTruthy();
    const entries = within(list as HTMLElement).getAllByRole('listitem');
    expect(entries.map((node) => node.textContent)).toEqual(['Available', 'En route', 'Case', 'Standby point', 'Coverage radius']);
    for (const entry of entries.slice(0, 4)) expect(entry.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(entries[4]?.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('has no legend box when there is nothing to explain', () => {
    const { container } = renderMap();
    expect(container.querySelectorAll('ul[class*="legend"]')).toHaveLength(0);
  });
});

describe('MapView: zoom', () => {
  const spread = (container: Element) => num(pin(container, 'SVR-2'), 'cx') - num(pin(container, 'SVR-1'), 'cx');

  it('zooms in, out and back with the buttons', () => {
    const { container } = renderMap();
    const start = spread(container);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const zoomed = spread(container);
    expect(zoomed).toBeGreaterThan(start);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(spread(container)).toBeLessThan(start);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(spread(container)).toBe(start);
  });

  it('stops at the limits, keeping keyboard focus: the button is aria-disabled, not disabled', () => {
    const { container } = renderMap();
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 5; i += 1) fireEvent.click(zoomIn);
    expect(zoomIn.getAttribute('aria-disabled')).toBe('true');
    expect((zoomIn as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Zoom out' }).hasAttribute('aria-disabled')).toBe(false);
    const before = num(pin(container, 'SVR-2'), 'cx');
    fireEvent.click(zoomIn);
    expect(num(pin(container, 'SVR-2'), 'cx')).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(zoomIn.hasAttribute('aria-disabled')).toBe(false);
  });

  it('has nothing to reset at the start', () => {
    renderMap();
    expect(screen.getByRole('button', { name: 'Reset view' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('zooms with the + and - keys and resets with 0', () => {
    const { container } = renderMap();
    const root = container.querySelector('[data-state]') as HTMLElement;
    const start = spread(container);
    fireEvent.keyDown(root, { key: '+' });
    expect(spread(container)).toBeGreaterThan(start);
    fireEvent.keyDown(root, { key: '-' });
    expect(spread(container)).toBe(start);
    fireEvent.keyDown(root, { key: '=' });
    fireEvent.keyDown(root, { key: '0' });
    expect(spread(container)).toBe(start);
    fireEvent.keyDown(root, { key: '+', ctrlKey: true });
    expect(spread(container)).toBe(start);
  });

  it('labels the three buttons in Arabic', () => {
    renderMap({}, 'ar');
    for (const name of ['تكبير', 'تصغير', 'إعادة ضبط العرض']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });
});

describe('MapView: picture or buttons', () => {
  it('is a picture with a text alternative when there is no onSelect: nothing focusable on the map', () => {
    const { container } = renderMap();
    expect(items(container)).toHaveLength(0);
    expect(container.querySelector('svg [tabindex]')).toBeNull();
    expect(container.querySelector('svg [role="button"]')).toBeNull();
  });

  it('makes zones and pins buttons with names when there is an onSelect', () => {
    const { container } = renderMap({ onSelect: () => undefined, label: 'Coverage' });
    expect(screen.getByRole('group', { name: 'Coverage' })).toBeTruthy();
    expect(items(container)).toHaveLength(7);
    const names = items(container).map((node) => node.getAttribute('aria-label'));
    expect(names).toEqual([
      'RD-C: Recommend',
      'RD-E: Shadow',
      'RD-W: Level 4 of 5',
      'Sara Al-Habuli: Available',
      'Adel Al-Ghaari: En route',
      'RD-260913-00230: Case',
      'Olaya standby: Standby point',
    ]);
    // The buttons are the alternative, so the plain list is not repeated.
    expect(screen.queryByRole('list', { name: 'Points' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sara Al-Habuli: Available' })).toBeTruthy();
  });

  it('says which zone and pin are chosen', () => {
    const { container } = renderMap({
      onSelect: () => undefined,
      zones: [{ ...(ZONES[0] as MapZone), active: true }, ZONES[1] as MapZone],
    });
    expect(items(container).map((node) => node.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'true']);
  });

  it('is one tab stop: the first item is reachable, the rest are not', () => {
    const { container } = renderMap({ onSelect: () => undefined });
    const stops = items(container).filter((node) => node.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(items(container)[0]);
    expect(items(container).slice(1).every((node) => node.getAttribute('tabindex') === '-1')).toBe(true);
  });

  it('moves between items with the arrow keys, Home and End, and keeps the tab stop where focus last was', () => {
    const { container } = renderMap({ onSelect: () => undefined });
    const all = items(container);
    all[0]?.focus();
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(all[0] as Element, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(all[1]);
    fireEvent.keyDown(all[1] as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(all[2]);
    fireEvent.keyDown(all[2] as Element, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(all[1]);
    fireEvent.keyDown(all[1] as Element, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(all[0]);
    // Wraps around at both ends.
    fireEvent.keyDown(all[0] as Element, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(all[6]);
    fireEvent.keyDown(all[6] as Element, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(all[0] as Element, { key: 'End' });
    expect(document.activeElement).toBe(all[6]);
    fireEvent.keyDown(all[6] as Element, { key: 'Home' });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(all[0] as Element, { key: 'ArrowDown' });
    fireEvent.keyDown(all[1] as Element, { key: 'ArrowDown' });
    expect(items(container).filter((node) => node.getAttribute('tabindex') === '0')).toEqual([all[2]]);
  });

  it('means the same arrows in Arabic: the plot never flips', () => {
    const { container } = renderMap({ onSelect: () => undefined }, 'ar');
    const all = items(container);
    all[0]?.focus();
    fireEvent.keyDown(all[0] as Element, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(all[1]);
  });

  it('selects a zone or a pin with Enter, Space or a click, and says what was chosen', () => {
    const onSelect = vi.fn();
    const { container } = renderMap({ onSelect });
    const all = items(container);
    fireEvent.keyDown(all[0] as Element, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'zone', id: 'RD-C' });
    fireEvent.keyDown(all[4] as Element, { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'pin', id: 'SVR-2' });
    fireEvent.click(all[2] as Element);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'zone', id: 'RD-W' });
    fireEvent.click(all[6] as Element);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'pin', id: 'SB-1' });
    expect(onSelect).toHaveBeenCalledTimes(4);
    // Other keys do nothing.
    fireEvent.keyDown(all[0] as Element, { key: 'a' });
    expect(onSelect).toHaveBeenCalledTimes(4);
  });

  it('keeps the tab stop on the item that last had focus, and returns it to the first when that item goes away', () => {
    const onSelect = () => undefined;
    const view = renderMap({ onSelect });
    const last = items(view.container)[6] as SVGGElement;
    act(() => last.focus());
    expect(items(view.container)[6]?.getAttribute('tabindex')).toBe('0');
    expect(items(view.container)[0]?.getAttribute('tabindex')).toBe('-1');
    view.rerender(<MapView zones={ZONES} pins={PINS.slice(0, 3)} onSelect={onSelect} />);
    const after = items(view.container);
    expect(after).toHaveLength(6);
    expect(after[0]?.getAttribute('tabindex')).toBe('0');
    expect(after.filter((node) => node.getAttribute('tabindex') === '0')).toHaveLength(1);
  });
});

describe('MapView: what a translator must leave alone', () => {
  it('marks the plot translate="no": zone codes and the names of pins are data, and the controls and the legend are not inside it', () => {
    const { container } = renderMap({ legend: [{ dot: 'available', label: 'Available' }], onSelect: () => undefined });
    const plot = container.querySelector('[data-map-plot]');
    expect(plot?.getAttribute('translate')).toBe('no');
    expect(plot?.querySelectorAll('g[role="button"][aria-label]').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Zoom in' }).closest('[translate="no"]')).toBeNull();
  });

  it('marks the names in the text alternative of a picture (no onSelect) translate="no" too', () => {
    const { container } = renderMap({ onSelect: undefined });
    const items = [...container.querySelectorAll('ul[aria-label] li')];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.getAttribute('translate')).toBe('no');
  });
});

describe('MapView: left to right always', () => {
  it('draws the plot left to right on an Arabic page, and lets the legend and controls follow the page', () => {
    const { container } = renderMap({ legend: [{ dot: 'available', label: 'متاح' }] }, 'ar');
    const plot = container.querySelector('[data-map-plot]');
    expect(plot?.getAttribute('dir')).toBe('ltr');
    expect(plot?.querySelector('svg')).not.toBeNull();
    // Outside the plot the nearest direction is the page's.
    const controls = screen.getByRole('button', { name: 'تكبير' });
    expect(controls.closest('[data-map-plot]')).toBeNull();
    expect(controls.closest('[dir]')?.getAttribute('dir')).toBe('rtl');
    const legend = screen.getAllByRole('list').find((node) => node.textContent === 'متاح');
    expect(legend?.closest('[dir]')?.getAttribute('dir')).toBe('rtl');
  });

  it('puts the same place at the same x in both languages', () => {
    const en = renderMap();
    const enX = num(pin(en.container, 'SVR-2'), 'cx');
    cleanup();
    const ar = renderMap({}, 'ar');
    expect(num(pin(ar.container, 'SVR-2'), 'cx')).toBe(enX);
  });
});

describe('MapView: Arabic', () => {
  it('names everything in Arabic and leaves only the data in Latin letters, with Western digits', () => {
    const { container } = renderMap({ legend: [{ dot: 'case', label: 'بلاغ' }] }, 'ar');
    const text = readableText(container);
    expect(hasLatinLetters(text, DATA_VALUES)).toBe(false);
    expect(hasArabicIndicDigits(text)).toBe(false);
    expect(screen.getByText('خريطة تخطيطية')).toBeTruthy();
    expect(container.textContent).toContain('المناطق: 3، النقاط: 4');
    expect(within(screen.getByRole('list', { name: 'المناطق' })).getAllByRole('listitem').map((node) => node.textContent)).toEqual([
      'RD-C: التوصية',
      'RD-E: التشغيل الظلّي',
      'RD-W: المستوى 4 من 5',
    ]);
    expect(within(screen.getByRole('list', { name: 'النقاط' })).getAllByRole('listitem').map((node) => node.textContent)).toEqual([
      'Sara Al-Habuli: متاح',
      'Adel Al-Ghaari: في الطريق',
      'RD-260913-00230: بلاغ',
      'Olaya standby: نقطة تمركز',
    ]);
  });

  it('names the interactive buttons in Arabic too', () => {
    const { container } = renderMap({ onSelect: () => undefined }, 'ar');
    const names = items(container).map((node) => node.getAttribute('aria-label') ?? '');
    expect(hasLatinLetters(names.join(' '), DATA_VALUES)).toBe(false);
    expect(names[0]).toBe('RD-C: التوصية');
  });
});

describe('MapView: loading, empty and error', () => {
  it('shows a skeleton while loading, announced as loading, with no svg and no controls', () => {
    const { container } = renderMap({ state: 'loading' });
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain('Loading');
    expect(container.querySelector('[data-map-plot]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    renderMap({ state: 'loading' }, 'ar');
    expect(screen.getByRole('status').textContent).toContain('جارٍ التحميل');
  });

  it('says so when there is nothing to draw', () => {
    const { container } = renderMap({ zones: [], pins: [] });
    expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('Nothing to show on the map')).toBeTruthy();
    expect(container.querySelector('[data-map-plot]')).toBeNull();
    cleanup();
    inLocale('ar', <MapView />);
    expect(screen.getByText('لا شيء لعرضه على الخريطة')).toBeTruthy();
  });

  it('is empty when every coordinate is invalid', () => {
    const { container } = renderMap({ zones: [{ code: 'X', lat: Number.NaN, lon: 1, radiusKm: 1 }], pins: [] });
    expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('empty');
  });

  it('shows the error, announced, with a retry only when it can retry', () => {
    const onRetry = vi.fn();
    const { container } = renderMap({ state: 'error', onRetry });
    expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('The map could not be drawn');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    cleanup();
    renderMap({ state: 'error' });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('writes the error and the retry in Arabic', () => {
    renderMap({ state: 'error', onRetry: () => undefined }, 'ar');
    expect(screen.getByRole('alert').textContent).toContain('تعذّر رسم الخريطة');
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
  });

  it('keeps its height in every state, so the page does not jump', () => {
    for (const props of [{ state: 'loading' as const }, { state: 'error' as const }, { zones: [], pins: [] }, {}]) {
      const { container } = renderMap({ height: 300, ...props });
      expect((container.querySelector('[data-state]') as HTMLElement).style.blockSize).toBe('300px');
      cleanup();
    }
  });
});

describe('MapView: no network, no map library', () => {
  it('draws without a request', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderMap({ onSelect: () => undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
