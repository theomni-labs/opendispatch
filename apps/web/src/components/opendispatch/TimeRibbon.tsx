'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useFormat } from '@opendispatch/ui';
import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react';
import { cx } from './cx';
import { tickHours, type RibbonSegment, type RibbonTone } from './ribbon-geometry';
import styles from './TimeRibbon.module.css';

// A day (or any stretch of hours) as a strip of coloured segments with time ticks under it: the mockup's ribbon. Shift
// patterns (Shift and Break Policies), and later the Ops break planner, draw their day with it. Left to right always, in both
// languages: like every time axis, chart plot and the map, the ribbon never flips. The labels,
// the legend and any text around it follow the page direction and are the caller's.
//
//   <TimeRibbon label="Field shifts, normal hours" segments={[{ from: 6, to: 14, label: 'Day A', tone: 1 }, ...]} tickEvery={4} />
//
// Hours are numbers from `start` to `end` (default 0 to 24): 6.5 is 06:30. A segment that runs past midnight is two segments;
// `daySegments` splits one. The segments are a picture with a text alternative, not controls.

export interface TimeRibbonProps {
  readonly segments: readonly RibbonSegment[];
  /** The name of the ribbon for assistive technology, in the reader's language. */
  readonly label: string;
  readonly start?: number | undefined;
  readonly end?: number | undefined;
  /** A tick every this many hours. Default 4. */
  readonly tickEvery?: number | undefined;
}

// The pure helpers are in ribbon-geometry.ts (a Server Component may use them); they are re-exported here for the client files.
export { daySegments, hoursOf, type RibbonSegment, type RibbonTone } from './ribbon-geometry';

const TONES: Readonly<Record<RibbonTone, string | undefined>> = { 1: styles.t1, 2: styles.t2, 3: styles.t3, 4: styles.t4, 5: styles.t5, 6: styles.t6 };
const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);
const clock = (hours: number): string => {
  const whole = Math.floor(hours + 1e-9);
  const minutes = Math.round((hours - whole) * 60);
  return `${String(whole % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export function TimeRibbon({ segments, label, start = 0, end = 24, tickEvery = 4 }: TimeRibbonProps) {
  const format = useFormat();
  const describedBy = useId();
  const span = end - start;
  const pct = (hours: number): number => ((clamp(hours, start, end) - start) / span) * 100;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => setWidth(element.clientWidth > 0 ? element.clientWidth : null);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // On a narrow screen labels are thinned so they never touch.
  const ticks = tickHours(start, end, tickEvery, width);
  // A tick is the label of an hour, in Western digits whatever the language; the formatter writes it (no hand-made digits).
  const tick = (hours: number): string => format.time(Math.round(hours * 60) % 1440);

  return (
    <div ref={ref} className={styles.ribbon} dir="ltr">
      <div className={styles.track} role="img" aria-label={label} aria-describedby={describedBy}>
        {segments.map((segment, index) => (
          <span
            key={index}
            className={cx(styles.segment, TONES[segment.tone ?? 1])}
            style={{ insetInlineStart: `${pct(segment.from)}%`, inlineSize: `${Math.max(pct(segment.to) - pct(segment.from), 0)}%` }}
            title={segment.label}
            translate={segment.data === true ? 'no' : undefined}
          />
        ))}
      </div>
      <span id={describedBy} className={styles.srOnly}>
        {segments.map((segment, index) => (
          <Fragment key={index}>
            {index === 0 ? '' : ', '}
            <span translate={segment.data === true ? 'no' : undefined}>{segment.label}</span>
            {` ${clock(segment.from)} - ${clock(segment.to)}`}
          </Fragment>
        ))}
      </span>
      <div className={styles.ticks} aria-hidden="true">
        {ticks.map((hours) => (
          <span key={hours} className={styles.tick} style={{ insetInlineStart: `${pct(hours)}%` }}>
            {tick(hours)}
          </span>
        ))}
      </div>
    </div>
  );
}
