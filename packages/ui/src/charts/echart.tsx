// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useEffect, useRef, useState } from 'react';
import { useColorScheme, useDir } from '../provider';
import styles from './chart.module.css';

/**
 * Hosts one ECharts instance (SVG renderer) in a box of fixed height. ECharts is loaded on the client only, and only
 * when the box has a size, so server rendering and jsdom tests see the accessible element without a drawing.
 * Colours may be CSS custom properties (`var(--od-chart-1)`): they are read from the page before ECharts sees
 * them, and read again when the theme changes.
 */

type Option = Record<string, unknown>;
export type ColorReader = (value: string) => string;
type EChartsInstance = { setOption: (option: Option, notMerge?: boolean) => void; resize: () => void; dispose: () => void };

const VARIABLE = /^var\((--[\w-]+)\)$/;

function readerFor(element: Element): ColorReader {
  const style = getComputedStyle(element);
  return (value) => {
    const match = VARIABLE.exec(value.trim());
    if (!match?.[1]) return value;
    return style.getPropertyValue(match[1]).trim() || value;
  };
}

let loader: Promise<(element: HTMLElement) => EChartsInstance> | null = null;

function loadECharts(): Promise<(element: HTMLElement) => EChartsInstance> {
  loader ??= Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]).then(([core, charts, components, renderers]) => {
    core.use([
      charts.LineChart,
      charts.BarChart,
      components.GridComponent,
      components.TooltipComponent,
      components.MarkLineComponent,
      renderers.SVGRenderer,
    ]);
    return (element: HTMLElement) => core.init(element, undefined, { renderer: 'svg' }) as unknown as EChartsInstance;
  });
  return loader;
}

/** Bumps when the page switches between light and dark, so colours are read again. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    media?.addEventListener('change', bump);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', bump);
    };
  }, []);
  return version;
}

export interface EChartProps {
  /** Builds the ECharts option. `color` turns a CSS colour or custom property into a value ECharts can draw. */
  build: (color: ColorReader, dir: 'ltr' | 'rtl') => Option;
  height: number;
  /** The accessible name of the drawing. */
  label: string;
}

export function EChart({ build, height, label }: EChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsInstance | null>(null);
  const dir = useDir();
  const scheme = useColorScheme();
  const themeVersion = useThemeVersion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element || element.clientWidth === 0) return undefined;
    let cancelled = false;
    void loadECharts().then((init) => {
      if (cancelled || !box.current) return;
      chart.current = init(box.current);
      setReady(true);
    });
    const observer = new ResizeObserver(() => chart.current?.resize());
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      chart.current?.dispose();
      chart.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready || !chart.current || !box.current) return;
    chart.current.setOption(build(readerFor(box.current), dir), true);
  }, [ready, build, dir, scheme, themeVersion]);

  return (
    <div className={styles.canvas} style={{ blockSize: height }}>
      <div ref={box} className={styles.drawing} role="img" aria-label={label} />
    </div>
  );
}
