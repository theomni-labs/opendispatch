// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { CaretDownOutlined, CaretUpOutlined, LeftOutlined, RightOutlined, SwapOutlined } from '@ant-design/icons';
import { Button, Checkbox, Empty, Select } from 'antd';
import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { textCollator } from '../format';
import { useLabels, useLocale, useNavigate } from '../provider/provider';
import { useFormat } from '../provider/use-format';
import { cx, type Tone } from '../types';
import styles from './data-table.module.css';

/**
 * A semantic <table> styled like an Ant Design table: sortable headers (a button in the header, aria-sort on the
 * <th>), optional row selection with a bulk bar, rows that open a page, a tone tint per row, a totals footer and
 * client-side paging. Ant Design's Checkbox, Empty, Button and Select do the controls.
 */

export interface DataTableSort {
  key: string;
  direction: 'asc' | 'desc';
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Makes the column sortable. Text sorts by the provider's language, numbers as numbers. */
  sortValue?: ((row: T) => string | number) | undefined;
  /** "start" and "end" follow the reading direction. Use "end" for numbers. */
  align?: 'start' | 'end' | 'center' | undefined;
  width?: number | string | undefined;
  /** Hidden below 768px ("md") or 1024px ("lg"). */
  hideBelow?: 'md' | 'lg' | undefined;
  /** Stays in view on horizontal scroll (first column). */
  sticky?: boolean | undefined;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** What a screen reader hears for a row's checkbox. Default: the row id. */
  rowLabel?: ((row: T) => string) | undefined;
  /** The whole row opens this page. Clicks on controls inside the row do not. */
  rowHref?: ((row: T) => string) | undefined;
  selectable?: boolean | undefined;
  bulkActions?: ((selectedIds: string[], clear: () => void) => ReactNode) | undefined;
  /** Default 10; 0 turns paging off. */
  pageSize?: number | undefined;
  dense?: boolean | undefined;
  defaultSort?: DataTableSort | undefined;
  /** Controlled sort; null is "not sorted". */
  sort?: DataTableSort | null | undefined;
  onSortChange?: ((sort: DataTableSort) => void) | undefined;
  /** Controlled page, 1-based. */
  page?: number | undefined;
  onPageChange?: ((page: number) => void) | undefined;
  emptyState?: ReactNode;
  /** Totals: <tr> elements, or <td> cells (wrapped in a row), or anything else across the full width. */
  footer?: ReactNode;
  /** The table's name, read by screen readers. */
  caption?: string | undefined;
  stickyHeader?: boolean | undefined;
  rowTone?: ((row: T) => Tone | undefined) | undefined;
  className?: string | undefined;
}

interface CellProps {
  className?: string | undefined;
  colSpan?: number | string;
  'data-hide-below'?: string;
  children?: ReactNode;
}

const TONE_CLASS: Record<Tone, string | undefined> = {
  neutral: styles['toneNeutral'],
  accent: styles['toneAccent'],
  success: styles['toneSuccess'],
  warning: styles['toneWarning'],
  danger: styles['toneDanger'],
  info: styles['toneInfo'],
};

/** Elements inside a row that keep their own click. */
const OWN_CLICK =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [contenteditable="true"], [data-row-click="ignore"]';

const PAGE_SIZES = [10, 25, 50, 100];

/** Icons carry no name of their own (Ant Design names them in English): the control around them is named. */
const QUIET = { 'aria-hidden': true, 'aria-label': '' } as const;

function spanOf(props: CellProps): number {
  const span = Math.floor(Number(props.colSpan));
  return Number.isFinite(span) && span > 1 ? span : 1;
}

function flatten(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement(child) && child.type === Fragment ? flatten((child.props as { children?: ReactNode }).children) : [child],
  );
}

function isElementOf(node: ReactNode, ...tags: string[]): node is ReactElement<CellProps> {
  return isValidElement(node) && typeof node.type === 'string' && tags.includes(node.type);
}

/** True when a row click came from a control in the row, a portal, or ended a text selection. */
function clickBelongsElsewhere(event: MouseEvent<HTMLTableRowElement>): boolean {
  const target = event.target;
  if (!(target instanceof Element) || !event.currentTarget.contains(target)) return true;
  const control = target.closest(OWN_CLICK);
  if (control && event.currentTarget.contains(control)) return true;
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  return Boolean(selection && selection.type === 'Range' && selection.toString().length > 0);
}

function compare(a: string | number, b: string | number, collator: Intl.Collator): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
}

type PageEntry = number | 'gap-a' | 'gap-b';

/** Page numbers to show, with gaps: 1 ... 4 5 6 ... 20. */
function pageList(current: number, count: number): PageEntry[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  let from = Math.max(2, current - 1);
  let to = Math.min(count - 1, current + 1);
  if (current <= 3) [from, to] = [2, 4];
  else if (current >= count - 2) [from, to] = [count - 3, count - 1];
  const list: PageEntry[] = [1];
  if (from > 2) list.push('gap-a');
  for (let p = from; p <= to; p += 1) list.push(p);
  if (to < count - 1) list.push('gap-b');
  list.push(count);
  return list;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  rowLabel,
  rowHref,
  selectable = false,
  bulkActions,
  pageSize: firstPageSize = 10,
  dense = false,
  defaultSort,
  sort: sortProp,
  onSortChange,
  page: pageProp,
  onPageChange,
  emptyState,
  footer,
  caption,
  stickyHeader = false,
  rowTone,
  className,
}: DataTableProps<T>) {
  const navigate = useNavigate();
  const label = useLabels();
  const { int } = useFormat();
  const collator = textCollator(useLocale());
  const [ownSort, setOwnSort] = useState<DataTableSort | null>(defaultSort ?? null);
  const [ownPage, setOwnPage] = useState(1);
  const [pageSize, setPageSize] = useState(firstPageSize);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  const sort = sortProp === undefined ? ownSort : sortProp;
  const page = pageProp ?? ownPage;

  const ordered = useMemo(() => {
    const read = sort ? columns.find((column) => column.key === sort.key)?.sortValue : undefined;
    if (!sort || !read) return rows;
    const sign = sort.direction === 'asc' ? 1 : -1;
    return rows
      .map((row, index) => ({ row, index, value: read(row) }))
      .sort((a, b) => compare(a.value, b.value, collator) * sign || a.index - b.index)
      .map((entry) => entry.row);
  }, [rows, columns, sort, collator]);

  const paged = pageSize > 0;
  const pageCount = paged ? Math.max(1, Math.ceil(ordered.length / pageSize)) : 1;
  const current = Math.min(Math.max(page, 1), pageCount);
  const shown = paged ? ordered.slice((current - 1) * pageSize, current * pageSize) : ordered;

  const selectedIds = selectable ? rows.map(getRowId).filter((id) => picked.has(id)) : [];
  const shownIds = shown.map(getRowId);
  const shownPicked = shownIds.filter((id) => picked.has(id)).length;
  const allShownPicked = shownIds.length > 0 && shownPicked === shownIds.length;
  const someShownPicked = shownPicked > 0 && !allShownPicked;
  const stickyColumn = columns.some((column) => column.sticky);
  const span = columns.length + (selectable ? 1 : 0);
  const showPager = paged && ordered.length > Math.min(firstPageSize || pageSize, pageSize);
  const sizes = [...new Set([...PAGE_SIZES, firstPageSize].filter((n) => n > 0))].sort((a, b) => a - b);
  const bulkOpen = selectable && selectedIds.length > 0;
  const selectAllName = label(allShownPicked ? 'dataTable.deselectAllRows' : 'dataTable.selectAllRows');
  const skipTab = bulkOpen ? { tabIndex: -1 } : {};

  const clear = () => setPicked(new Set());
  const toggleRow = (id: string) =>
    setPicked((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleShown = () =>
    setPicked((before) => {
      const next = new Set(before);
      for (const id of shownIds) {
        if (allShownPicked) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const goTo = (next: number) => {
    if (pageProp === undefined) setOwnPage(next);
    if (next !== current) onPageChange?.(next);
  };

  const sortBy = (key: string) => {
    const next: DataTableSort = { key, direction: sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc' };
    if (sortProp === undefined) setOwnSort(next);
    onSortChange?.(next);
    goTo(1);
  };

  const hideClass = (hide: Column<T>['hideBelow']) => {
    if (hide === 'md') return styles['hideMd'];
    if (hide === 'lg') return styles['hideLg'];
    return undefined;
  };

  const cellClass = (column: Column<T>) =>
    cx(
      column.align === 'end' && styles['alignEnd'],
      column.align === 'center' && styles['alignCenter'],
      hideClass(column.hideBelow),
      column.sticky && styles['stickyColumn'],
      column.sticky && selectable && styles['stickyAfterSelect'],
    );

  // A footer cell hides with the columns above it, when all of them hide.
  const footerHide = (start: number, width: number): string | undefined => {
    if (start < 0) return undefined;
    const above = columns.slice(start, start + width);
    if (above.length < width || above.some((column) => !column.hideBelow)) return undefined;
    return above.every((column) => column.hideBelow === 'lg') ? styles['hideLg'] : styles['hideMd'];
  };

  const placeFooterCells = (cells: ReactNode[], first: number): ReactNode[] => {
    let at = first;
    return cells.map((cell) => {
      if (!isElementOf(cell, 'td', 'th')) return cell;
      const width = spanOf(cell.props);
      const start = at;
      at += width;
      if (cell.props['data-hide-below'] !== undefined) return cell;
      const hide = footerHide(start, width);
      return hide ? cloneElement(cell, { className: cx(cell.props.className, hide) }) : cell;
    });
  };

  const selectCellClass = cx(styles['selectCell'], stickyColumn && styles['stickySelect']);

  const footerRows = (): ReactNode => {
    const nodes = flatten(footer);
    if (nodes.length > 0 && nodes.every((node) => isElementOf(node, 'tr'))) {
      return nodes.map((node) => {
        const row = node as ReactElement<CellProps>;
        const cells = flatten(row.props.children);
        const total = cells.reduce<number>((sum, cell) => sum + (isElementOf(cell, 'td', 'th') ? spanOf(cell.props) : 0), 0);
        return cloneElement(row, undefined, ...placeFooterCells(cells, selectable && total === span ? -1 : 0));
      });
    }
    if (nodes.length > 0 && nodes.every((node) => isElementOf(node, 'td', 'th'))) {
      return (
        <tr>
          {selectable ? <td className={selectCellClass} /> : null}
          {placeFooterCells(nodes, 0)}
        </tr>
      );
    }
    return (
      <tr>
        <td colSpan={span}>{footer}</td>
      </tr>
    );
  };

  const rowHandlers = (href: string | undefined) => {
    if (href === undefined) return {};
    return {
      tabIndex: 0,
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if (event.defaultPrevented || clickBelongsElsewhere(event)) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          window.open(href, '_blank', 'noopener');
          return;
        }
        navigate(href);
      },
      onAuxClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if (event.button !== 1 || clickBelongsElsewhere(event)) return;
        event.preventDefault();
        window.open(href, '_blank', 'noopener');
      },
      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
        if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
        event.preventDefault();
        navigate(href);
      },
    };
  };

  const sortIcon = (active: boolean, direction: DataTableSort['direction'] | undefined) => {
    if (!active) return <SwapOutlined rotate={90} {...QUIET} />;
    return direction === 'asc' ? <CaretUpOutlined {...QUIET} /> : <CaretDownOutlined {...QUIET} />;
  };

  const from = ordered.length === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, ordered.length);

  return (
    <div className={cx(styles['root'], dense && styles['dense'], className)}>
      {bulkOpen ? (
        <div className={styles['bulkBar']} role="region" aria-label={label('dataTable.bulkActions')}>
          <Checkbox aria-label={selectAllName} checked={allShownPicked} indeterminate={someShownPicked} onChange={toggleShown} />
          <span className={styles['bulkCount']} aria-live="polite">
            {label('dataTable.selectedCount', { n: selectedIds.length })}
          </span>
          {bulkActions ? <div className={styles['bulkActions']}>{bulkActions(selectedIds, clear)}</div> : null}
          <Button type="link" size="small" onClick={clear}>
            {label('dataTable.clearSelection')}
          </Button>
        </div>
      ) : null}
      <div className={cx(styles['scroll'], stickyHeader && styles['stickyHeader'])}>
        <table className={styles['table']}>
          {caption ? <caption className={styles['visuallyHidden']}>{caption}</caption> : null}
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className={selectCellClass}>
                  <Checkbox
                    aria-label={selectAllName}
                    checked={allShownPicked}
                    indeterminate={someShownPicked}
                    onChange={toggleShown}
                    disabled={shownIds.length === 0}
                    {...skipTab}
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const sortable = column.sortValue !== undefined;
                const active = sort?.key === column.key;
                let ariaSort: 'ascending' | 'descending' | 'none' | undefined;
                if (sortable && active) ariaSort = sort.direction === 'asc' ? 'ascending' : 'descending';
                else if (sortable) ariaSort = 'none';
                const style: CSSProperties | undefined =
                  column.width === undefined ? undefined : { width: column.width, minWidth: column.width };
                return (
                  <th key={column.key} scope="col" aria-sort={ariaSort} className={cellClass(column)} style={style}>
                    {sortable ? (
                      <button
                        type="button"
                        className={cx(styles['sortButton'], active && styles['sortActive'])}
                        onClick={() => sortBy(column.key)}
                        {...skipTab}
                      >
                        <span>{column.header}</span>
                        <span className={styles['sortIcon']} aria-hidden="true">
                          {sortIcon(active, sort?.direction)}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr className={styles['emptyRow']}>
                <td colSpan={span}>
                  {emptyState ?? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        <span className={styles['emptyText']}>
                          <strong>{label('dataTable.emptyTitle')}</strong>
                          <span>{label('dataTable.emptyDescription')}</span>
                        </span>
                      }
                    />
                  )}
                </td>
              </tr>
            ) : (
              shown.map((row) => {
                const id = getRowId(row);
                const href = rowHref?.(row);
                const selected = selectable && picked.has(id);
                const tone = rowTone?.(row);
                return (
                  <tr
                    key={id}
                    className={cx(
                      styles['row'],
                      href !== undefined && styles['clickable'],
                      tone && styles['toned'],
                      tone && TONE_CLASS[tone],
                    )}
                    data-tone={tone}
                    data-selected={selected || undefined}
                    aria-selected={selectable ? selected : undefined}
                    {...rowHandlers(href)}
                  >
                    {selectable ? (
                      <td className={selectCellClass} data-row-click="ignore">
                        <Checkbox
                          aria-label={label('dataTable.selectRow', { id: rowLabel ? rowLabel(row) : id })}
                          {...(rowLabel ? { translate: 'no' as const } : {})}
                          checked={selected}
                          onChange={() => toggleRow(id)}
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td key={column.key} className={cellClass(column)}>
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          {footer !== undefined && footer !== null && footer !== false && shown.length > 0 ? (
            <tfoot className={styles['footer']}>{footerRows()}</tfoot>
          ) : null}
        </table>
      </div>
      {showPager ? (
        <nav className={styles['pager']} aria-label={label('pagination.label')}>
          <div className={styles['pagerStart']}>
            <span aria-live="polite">{label('pagination.range', { from: int(from), to: int(to), total: int(ordered.length) })}</span>
            <Select
              size="small"
              aria-label={label('pagination.pageSize')}
              value={pageSize}
              options={sizes.map((n) => ({ value: n, label: int(n) }))}
              onChange={(n: number) => {
                setPageSize(n);
                goTo(1);
              }}
              popupMatchSelectWidth={false}
            />
          </div>
          <div className={styles['pagerEnd']}>
            <Button
              size="small"
              aria-label={label('pagination.previous')}
              icon={<LeftOutlined {...QUIET} className={styles['flip']} />}
              disabled={current <= 1}
              onClick={() => goTo(current - 1)}
            />
            <ul className={styles['pages']}>
              {pageList(current, pageCount).map((entry) =>
                typeof entry === 'number' ? (
                  <li key={entry}>
                    <Button
                      size="small"
                      type={entry === current ? 'primary' : 'text'}
                      aria-current={entry === current ? 'page' : undefined}
                      aria-label={label('pagination.goToPage', { page: int(entry) })}
                      onClick={() => {
                        if (entry !== current) goTo(entry);
                      }}
                    >
                      {int(entry)}
                    </Button>
                  </li>
                ) : (
                  <li key={entry} aria-hidden="true" className={styles['gap']}>
                    …
                  </li>
                ),
              )}
            </ul>
            <Button
              size="small"
              aria-label={label('pagination.next')}
              icon={<RightOutlined {...QUIET} className={styles['flip']} />}
              disabled={current >= pageCount}
              onClick={() => goTo(current + 1)}
            />
          </div>
        </nav>
      ) : null}
    </div>
  );
}
