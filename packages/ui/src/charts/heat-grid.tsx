// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { num } from '../format';
import { useDir, useLabels } from '../provider';
import { useTitled } from './chart-text';
import styles from './heat-grid.module.css';

/**
 * How a value becomes a colour. "scale": one tone, stronger as the value grows. "signed": below zero is a gap, above
 * zero a surplus, zero is balanced. "gap" and "surplus": every value is that kind and only the strength varies.
 */
export type HeatKind = 'scale' | 'signed' | 'gap' | 'surplus';
export type HeatCellKind = 'gap' | 'surplus' | 'ok' | 'scale';

/** The cell handed to `onCellSelect`: indexes into `rows` and `columns`. */
export interface HeatCell {
  row: number;
  column: number;
  value: number;
  kind: HeatCellKind;
}

export interface HeatGridProps {
  rows: string[];
  columns: string[];
  /** values[row][column]; null, undefined and NaN leave a cell empty. */
  values: (number | null | undefined)[][];
  format?: (n: number) => string;
  kind?: HeatKind;
  tone?: 'accent' | 'warning' | 'danger';
  /** Narrowest column in pixels; the grid scrolls sideways when the columns do not fit. Default 44. */
  minColWidth?: number;
  /** Cells without text; the value stays in each cell's name and title. */
  compact?: boolean;
  label?: string;
  /** Makes cells with a value buttons: click, Enter and Space call it. */
  onCellSelect?: (cell: HeatCell) => void;
}

type Filled = { value: number; kind: HeatCellKind; strength: number };
type GridStyle = CSSProperties & Record<`--${string}`, string | number>;

const TONE_VARIABLE = { accent: '--od-color-primary', warning: '--od-color-warning', danger: '--od-color-error' } as const;
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function cellsOf(values: HeatGridProps['values'], rows: number, columns: number, kind: HeatKind) {
  const all: number[] = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < columns; c += 1) if (finite(values[r]?.[c])) all.push(values[r]?.[c] as number);
  const lo = Math.min(0, ...all);
  const hi = all.length > 0 ? Math.max(...all) : 0;
  const largest = Math.max(0, ...all.map((v) => Math.abs(v)));
  const cells: (Filled | null)[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const line: (Filled | null)[] = [];
    for (let c = 0; c < columns; c += 1) {
      const value = values[r]?.[c];
      if (!finite(value)) {
        line.push(null);
        continue;
      }
      if (kind === 'scale') {
        const span = hi - lo;
        const share = span > 0 ? (value - lo) / span : value === 0 ? 0 : 0.5;
        line.push({ value, kind: 'scale', strength: share });
        continue;
      }
      let cellKind: HeatCellKind = 'ok';
      if (kind === 'gap' || (kind === 'signed' && value < 0)) cellKind = 'gap';
      else if (kind === 'surplus' || (kind === 'signed' && value > 0)) cellKind = 'surplus';
      line.push({ value, kind: cellKind, strength: largest > 0 ? Math.abs(value) / largest : 0 });
    }
    cells.push(line);
  }
  return { cells, lo, hi };
}

function background(cell: Filled, tone: keyof typeof TONE_VARIABLE): string {
  if (cell.kind === 'ok') return 'var(--od-color-bg-subtle)';
  let variable: string = TONE_VARIABLE[tone];
  if (cell.kind === 'gap') variable = '--od-color-error';
  if (cell.kind === 'surplus') variable = '--od-color-info';
  const percent = Math.round(6 + cell.strength * 64);
  return `color-mix(in srgb, var(${variable}) ${String(percent)}%, var(--od-color-bg-container))`;
}

/** A grid of coloured cells as an accessible table; arrow keys move between cells. */
export function HeatGrid({
  rows,
  columns,
  values,
  format,
  kind = 'scale',
  tone = 'accent',
  minColWidth = 44,
  compact = false,
  label,
  onCellSelect,
}: HeatGridProps) {
  const t = useLabels();
  const titled = useTitled();
  const dir = useDir();
  const show = format ?? ((n: number) => num(n));
  const { cells, lo, hi } = useMemo(() => cellsOf(values, rows.length, columns.length, kind), [values, rows.length, columns.length, kind]);
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const table = useRef<HTMLTableElement>(null);

  const kindName = (cell: Filled) => {
    if (kind !== 'signed') return null;
    if (cell.kind === 'gap') return t('heatGrid.kindGap');
    if (cell.kind === 'surplus') return t('heatGrid.kindSurplus');
    return t('heatGrid.kindOk');
  };
  const nameOf = (r: number, c: number) => {
    const row = rows[r] ?? '';
    const column = columns[c] ?? '';
    const cell = cells[r]?.[c];
    if (!cell) return t('heatGrid.cellNoValue', { row, column });
    const kindText = kindName(cell);
    return kindText === null
      ? t('heatGrid.cell', { row, column, value: show(cell.value) })
      : t('heatGrid.cellKind', { row, column, value: show(cell.value), kind: kindText });
  };

  const move = (r: number, c: number) => {
    const row = Math.max(0, Math.min(rows.length - 1, r));
    const column = Math.max(0, Math.min(columns.length - 1, c));
    setFocus([row, column]);
    table.current?.querySelector<HTMLElement>(`[data-cell="${String(row)}-${String(column)}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const [r, c] = focus;
    const forward = dir === 'rtl' ? -1 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowRight: [r, c + forward],
      ArrowLeft: [r, c - forward],
      ArrowDown: [r + 1, c],
      ArrowUp: [r - 1, c],
      Home: [r, 0],
      End: [r, columns.length - 1],
    };
    const next = moves[event.key];
    if (next) {
      event.preventDefault();
      move(next[0], next[1]);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && onCellSelect) {
      const cell = cells[r]?.[c];
      if (!cell) return;
      event.preventDefault();
      onCellSelect({ row: r, column: c, value: cell.value, kind: cell.kind });
    }
  };

  const summary = t('heatGrid.summary', { rows: rows.length, columns: columns.length, min: show(lo), max: show(hi) });
  const style: GridStyle = { '--heat-min-col': `${String(minColWidth)}px` };

  return (
    <div className={styles.scroller}>
      <table
        ref={table}
        role="grid"
        className={compact ? `${styles.grid} ${styles.compact}` : styles.grid}
        style={style}
        aria-label={titled(label, summary)}
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length + 1}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            <td className={styles.corner} aria-hidden="true" />
            {columns.map((column, c) => (
              <th key={`${column}-${String(c)}`} scope="col" className={styles.columnHead} title={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={`${row}-${String(r)}`}>
              <th scope="row" className={styles.rowHead}>
                {row}
              </th>
              {columns.map((column, c) => {
                const cell = cells[r]?.[c] ?? null;
                const name = nameOf(r, c);
                const active = focus[0] === r && focus[1] === c;
                const interactive = onCellSelect !== undefined && cell !== null;
                return (
                  <td
                    key={`${column}-${String(c)}`}
                    role="gridcell"
                    data-cell={`${String(r)}-${String(c)}`}
                    data-kind={cell?.kind ?? 'none'}
                    className={interactive ? `${styles.cell} ${styles.interactive}` : styles.cell}
                    style={cell ? { background: background(cell, tone) } : undefined}
                    tabIndex={active ? 0 : -1}
                    aria-label={name}
                    title={name}
                    {...(interactive ? { 'aria-haspopup': 'dialog' as const } : {})}
                    onFocus={() => setFocus([r, c])}
                    onClick={interactive ? () => onCellSelect({ row: r, column: c, value: cell.value, kind: cell.kind }) : undefined}
                  >
                    {compact || !cell ? null : <span aria-hidden="true">{show(cell.value)}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
