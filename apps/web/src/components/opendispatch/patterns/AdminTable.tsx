'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { DataTable, type Column, type DataTableSort, type Tone } from '@opendispatch/ui';
import { useRef, useState, type ReactNode } from 'react';
import styles from './AdminTable.module.css';
import { useScrollCue } from './ScrollCue';
import type { SortParam } from './search-params';
import { useUrlState } from './useUrlState';

// A DataTable built from plain data. The design system's DataTable takes functions (`cell`, `getRowId`,
// `rowHref`), which a Server Component cannot pass, so a screen hands this client file rows and columns as data and it
// builds the DataTable:
//
//   <AdminTable caption={t('table.caption')} columns={[{ key: 'name', header: t('col.name'), sortable: true }, ...]}
//     rows={users.map((u) => ({ id: u.id, cells: { name: <span translate="no">{u.display_name}</span>, ... }, sort: { name: u.display_name } }))}
//     emptyState={<NoMatch clearParams={['q', 'role']} />} sort={query.sort} page={query.page} />
//
// A `cells` value is a React element built on the server (a StatusPill, a Tag, text), which may cross to the client; only
// functions may not. A screen that needs behaviour (a bulk action, a cell with a button) writes its own client file
// (`<Name>Tables.tsx`), where functions are allowed, and passes `bulkActions` here.
//
// A row opens its detail through the URL: a click or Enter goes to `?id=<row id>` with a push, so
// Back closes the drawer and a link opens it. Sort and page live in `sort=name:asc` and `page=2`; the screen validates
// them on the server (parseSearchParams) and passes the result in, and the table keeps them in step with the address
// without waiting for the server (a header click sorts at once, then the address follows).

export interface AdminTableColumn {
  readonly key: string;
  /** The header, already in the reader's language. */
  readonly header: ReactNode;
  readonly align?: 'start' | 'end' | 'center' | undefined;
  /** Hide under 768px (`md`) or 1024px (`lg`). At most 7 columns show by default (minimal.md). */
  readonly hideBelow?: 'md' | 'lg' | undefined;
  readonly width?: number | string | undefined;
  /** Sorted by the row's `sort[key]`. */
  readonly sortable?: boolean | undefined;
  readonly sticky?: boolean | undefined;
}

export interface AdminTableRow {
  /** The record id: the value of `?id=` when the row is opened. */
  readonly id: string;
  /**
   * The name of the record for a screen reader ("Select row {label}" on the checkbox): a person's name, a code. Without
   * it the id is read, which is often a UUID.
   */
  readonly label?: string | undefined;
  /** What each column shows, by column key. */
  readonly cells: Readonly<Record<string, ReactNode>>;
  /** What each sortable column sorts by (a string sorts by the reader's language, a number as a number). */
  readonly sort?: Readonly<Record<string, string | number>> | undefined;
  /** A tint and an edge at the inline start, for a row that needs attention (a `denied` audit event). */
  readonly tone?: Tone | undefined;
  /** Where the row goes instead of `?id=`. */
  readonly href?: string | undefined;
}

export interface AdminTableProps {
  readonly columns: readonly AdminTableColumn[];
  readonly rows: readonly AdminTableRow[];
  /** The screen-reader caption. */
  readonly caption: string;
  /** Shown when there are no rows: `<NoMatch />` for a filtered list. */
  readonly emptyState?: ReactNode;
  /** The parameter a row sets when opened. Default `id`. `false`: rows are not links. */
  readonly rowParam?: string | false | undefined;
  readonly selectable?: boolean | undefined;
  /** Client files only (a function): the bulk bar's buttons for the selected row ids. */
  readonly bulkActions?: ((selectedIds: string[], clear: () => void) => ReactNode) | undefined;
  /** Rows per page. Default 25; 0 shows all. */
  readonly pageSize?: number | undefined;
  /** From the server: the validated `sort` and `page` parameters. */
  readonly sort?: SortParam | undefined;
  readonly page?: number | undefined;
  readonly dense?: boolean | undefined;
}

const DEFAULT_PAGE_SIZE = 25;

export function AdminTable({ columns, rows, caption, emptyState, rowParam = 'id', selectable, bulkActions, pageSize = DEFAULT_PAGE_SIZE, sort, page, dense }: AdminTableProps) {
  const url = useUrlState();
  const sortable = new Set(columns.filter((c) => c.sortable === true).map((c) => c.key));

  // Local sort and page, so a header click answers at once; they follow the props when the server sends new ones.
  const validSort: DataTableSort | null = sort !== undefined && sortable.has(sort.key) ? { key: sort.key, direction: sort.direction } : null;
  const [localSort, setLocalSort] = useState<DataTableSort | null>(validSort);
  const [seenSort, setSeenSort] = useState(validSort);
  if (validSort?.key !== seenSort?.key || validSort?.direction !== seenSort?.direction) {
    setSeenSort(validSort);
    setLocalSort(validSort);
  }
  const [localPage, setLocalPage] = useState(page ?? 1);
  const [seenPage, setSeenPage] = useState(page ?? 1);
  if ((page ?? 1) !== seenPage) {
    setSeenPage(page ?? 1);
    setLocalPage(page ?? 1);
  }

  const dataColumns: Column<AdminTableRow>[] = columns.map((column) => ({
    key: column.key,
    header: column.header,
    cell: (row) => row.cells[column.key] ?? null,
    align: column.align,
    hideBelow: column.hideBelow,
    width: column.width,
    sticky: column.sticky,
    sortValue: column.sortable === true ? (row) => row.sort?.[column.key] ?? '' : undefined,
  }));

  const wrapRef = useRef<HTMLDivElement>(null);
  useScrollCue(wrapRef);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <DataTable
        columns={dataColumns}
        rows={[...rows]}
        getRowId={(row) => row.id}
        rowLabel={(row) => row.label ?? row.id}
        rowHref={rowParam === false ? undefined : (row) => row.href ?? url.hrefFor({ [rowParam]: row.id }, { keepPage: true })}
        selectable={selectable}
        bulkActions={bulkActions}
        pageSize={pageSize}
        dense={dense}
        caption={caption}
        rowTone={(row) => row.tone}
        emptyState={emptyState}
        sort={localSort}
        onSortChange={(next) => {
          setLocalSort(next);
          setLocalPage(1);
          url.update({ sort: `${next.key}:${next.direction}` });
        }}
        page={localPage}
        onPageChange={(next) => {
          setLocalPage(next);
          url.update({ page: next > 1 ? String(next) : null }, { keepPage: true });
        }}
      />
    </div>
  );
}
