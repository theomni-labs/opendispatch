'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, EmptyState, Skeleton, useFormat } from '@opendispatch/ui';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from './cx';
import {
  autoSlotWidth,
  columnsOf,
  fitBlockLabel,
  kindsPresent,
  slotFrom,
  slotSpan,
  slotsPerHour,
  tickLabel,
  type RosterBlockKind,
} from './roster-grid-geometry';
import styles from './RosterGrid.module.css';

// Roster grid: agent by shift

export { type RosterBlockKind } from './roster-grid-geometry';

/** A JSX style object that also sets the grid's own custom properties (--cols, --slot-w, --from, --span). */
type GridStyle = CSSProperties & { [name: `--${string}`]: string | number };

export interface RosterBlock {
  readonly kind: RosterBlockKind;
  /** Hours from midnight; may run past 24 for a shift that reaches into the next day. */
  readonly from: number;
  readonly to: number;
  /** Already in the reader's language. */
  readonly label: string;
  /** True when `label` is a record's own name or code (data), left alone by a translator. Default false. */
  readonly data?: boolean | undefined;
  /** The hover and text-alternative detail. Default: the label and the time range. */
  readonly tip?: string | undefined;
  /** A button that calls the grid's `onBlockSelect`. */
  readonly selectable?: boolean | undefined;
}

/** A shaded stretch drawn across every row, behind the blocks (a prayer window). */
export interface RosterBand {
  readonly from: number;
  readonly to: number;
}

export interface RosterRow {
  /** Stable across a redraw (an agent id, or a fixed id for a summary row such as "gap"). */
  readonly id: string;
  /** An agent's name, or a summary row's own text ("Gap"). */
  readonly name: string;
  /** True when `name` is a record's own name (a person). Default true. */
  readonly nameIsData?: boolean | undefined;
  /** A second line under the name (for example "Day A · SYN 6003"), already composed by the caller. */
  readonly sub?: string | undefined;
  /** True when `sub` is, or contains, a record's own value. Default false. */
  readonly subIsData?: boolean | undefined;
  readonly blocks: readonly RosterBlock[];
}

export interface RosterGridProps {
  readonly rows: readonly RosterRow[];
  /** The name column's own header, already in the reader's language (for example "Agent"). */
  readonly headLabel: string;
  /** The grid's name for assistive technology. Default: "Roster grid". */
  readonly label?: string | undefined;
  readonly startHour?: number | undefined;
  readonly endHour?: number | undefined;
  /** Minutes per column. Default 60; the Field Planner Workbench uses 15. */
  readonly stepMin?: number | undefined;
  /** A fixed column width in pixels. Default: fitted to the measured width, never below the readable minimum. */
  readonly slotWidth?: number | undefined;
  /** Shows only the block kinds actually drawn. Default true. */
  readonly legend?: boolean | undefined;
  /** loading: a skeleton. error: the error state (with a retry when `onRetry` is given). Default filled. */
  readonly state?: 'filled' | 'loading' | 'error' | undefined;
  readonly onRetry?: (() => void) | undefined;
  /** Shaded across every body row. */
  readonly bands?: readonly RosterBand[] | undefined;
  /** Called for a `selectable` block. */
  readonly onBlockSelect?: ((rowId: string, block: RosterBlock) => void) | undefined;
  /** The verb a selectable block's name starts with ("Adjust break"). */
  readonly selectLabel?: string | undefined;
  /** One more legend entry (a policy chip). */
  readonly legendExtra?: ReactNode;
}

const LOADING_ROW_WIDTHS = [70, 55, 82, 46, 90, 60] as const;
/** Below this measured width a read is a layout still settling, not a real size. */
const MIN_MEASURED_WIDTH = 40;

/** The width of the scroll box, kept up to date; 0 until measured, so the slot width starts at its readable minimum. */
function useMeasuredWidth(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
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

const BLOCK_CLASS: Readonly<Record<RosterBlockKind, string | undefined>> = {
  shift: styles.blockShift,
  break: styles.blockBreak,
  breakHolds: styles.blockBreakHolds,
  breakConflict: styles.blockBreakConflict,
  prayer: styles.blockPrayer,
  leave: styles.blockLeave,
  override: styles.blockOverride,
  gap: styles.blockGap,
};

export function RosterGrid({
  rows,
  headLabel,
  label,
  startHour = 0,
  endHour = 24,
  stepMin = 60,
  slotWidth,
  legend = true,
  state = 'filled',
  onRetry,
  bands = [],
  onBlockSelect,
  selectLabel,
  legendExtra,
}: RosterGridProps) {
  const t = useTranslations('opendispatch.roster');
  const tCommon = useTranslations('common');
  const format = useFormat();
  const uid = useId();
  const name = label ?? t('label');

  const mode = state !== 'filled' ? state : rows.length === 0 ? 'empty' : 'filled';
  const { ref, width } = useMeasuredWidth(mode === 'filled');

  const columns = columnsOf(startHour, endHour, stepMin);
  const perHour = slotsPerHour(stepMin);
  const resolvedSlotWidth = slotWidth ?? autoSlotWidth(width, columns, stepMin);
  const kinds = useMemo(() => kindsPresent(rows), [rows]);
  const hourTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let hour = startHour; hour < endHour; hour += 1) ticks.push(hour);
    return ticks;
  }, [startHour, endHour]);

  const clock = (hours: number): string => format.time(Math.round(hours * 60) % 1440);
  const timeRange = (from: number, to: number): string => `${clock(from)}–${clock(to)}`;

  if (mode === 'loading') {
    return (
      <div className={styles.loading} data-state="loading" role="status" aria-busy="true">
        <span className={styles.srOnly}>{tCommon('loading')}</span>
        <div aria-hidden="true">
          {LOADING_ROW_WIDTHS.map((pct, index) => (
            <div key={index} className={styles.loadingRow}>
              <Skeleton width={120} height={14} />
              <div className={styles.loadingTrack}>
                <Skeleton width={`${pct}%`} height={24} radius="sm" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'error') {
    return (
      <div className={styles.state} data-state="error">
        <EmptyState tone="danger" compact title={t('error')} action={onRetry ? <Button onClick={onRetry}>{tCommon('retry')}</Button> : undefined} />
      </div>
    );
  }

  if (mode === 'empty') {
    return (
      <div className={styles.state} data-state="empty">
        <EmptyState compact icon={<Users />} title={t('empty')} />
      </div>
    );
  }

  const gridStyle: GridStyle = { '--cols': columns, '--slot-w': `${resolvedSlotWidth}px` };

  return (
    <div className={styles.root} data-state="filled">
      <div ref={ref} className={styles.scroll}>
        <div className={styles.grid} style={gridStyle}>
          <div className={cx(styles.row, styles.rowHead)}>
            <div className={styles.name}>{headLabel}</div>
            <div className={styles.track} aria-hidden="true">
              {hourTicks.map((hour) => {
                const tickStyle: GridStyle = { '--from': slotFrom(hour, startHour, stepMin), '--span': perHour };
                return (
                  <span key={hour} className={styles.tick} style={tickStyle}>
                    {tickLabel(hour)}
                  </span>
                );
              })}
            </div>
          </div>

          {rows.map((row) => {
            const descId = `${uid}-${row.id}`;
            const hasBlocks = row.blocks.length > 0;
            const interactive = onBlockSelect !== undefined && row.blocks.some((block) => block.selectable === true);
            const description = row.blocks.map((block) => `${block.label}, ${timeRange(block.from, block.to)}`).join('. ');
            return (
              <div key={row.id} className={styles.row}>
                <div className={styles.name}>
                  <b translate={row.nameIsData === false ? undefined : 'no'}>{row.name}</b>
                  {row.sub !== undefined ? <span translate={row.subIsData === true ? 'no' : undefined}>{row.sub}</span> : null}
                </div>
                <div
                  className={styles.track}
                  role={interactive ? 'group' : 'img'}
                  aria-label={row.name}
                  aria-describedby={hasBlocks ? descId : undefined}
                >
                  {bands.map((band, index) => {
                    const bandStyle: GridStyle = { '--from': slotFrom(band.from, startHour, stepMin), '--span': slotSpan(band.from, band.to, stepMin) };
                    return <span key={`band-${String(index)}`} className={styles.band} style={bandStyle} aria-hidden="true" />;
                  })}
                  {row.blocks.map((block, index) => {
                    const blockStyle: GridStyle = { '--from': slotFrom(block.from, startHour, stepMin), '--span': slotSpan(block.from, block.to, stepMin) };
                    const title = block.tip ?? `${block.label} ${timeRange(block.from, block.to)}`;
                    const text = fitBlockLabel(block.label, slotSpan(block.from, block.to, stepMin) * resolvedSlotWidth);
                    if (block.selectable === true && onBlockSelect !== undefined) {
                      return (
                        <button
                          key={index}
                          type="button"
                          className={cx(styles.block, styles.blockButton, BLOCK_CLASS[block.kind])}
                          style={blockStyle}
                          title={title}
                          aria-label={`${selectLabel ?? block.label}, ${row.name}, ${timeRange(block.from, block.to)}`}
                          translate={block.data === true ? 'no' : undefined}
                          onClick={() => onBlockSelect(row.id, block)}
                        >
                          {text}
                        </button>
                      );
                    }
                    return (
                      <span key={index} className={cx(styles.block, BLOCK_CLASS[block.kind])} style={blockStyle} title={title} translate={block.data === true ? 'no' : undefined}>
                        {text}
                      </span>
                    );
                  })}
                </div>
                {hasBlocks ? (
                  <span id={descId} className={styles.srOnly}>
                    {description}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {legend && (kinds.length > 0 || legendExtra !== undefined) ? (
        <ul className={styles.legend} aria-label={name}>
          {kinds.map((kind) => (
            <li key={kind} className={styles.legendItem}>
              <i className={cx(styles.swatch, BLOCK_CLASS[kind])} aria-hidden="true" />
              {t(`kind.${kind}`)}
            </li>
          ))}
          {legendExtra === undefined ? null : <li className={styles.legendItem}>{legendExtra}</li>}
        </ul>
      ) : null}
    </div>
  );
}
