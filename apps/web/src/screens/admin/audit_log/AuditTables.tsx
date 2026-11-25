'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Pagination } from '@opendispatch/ui';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import styles from './AuditLog.module.css';
import type { ReactNode } from 'react';

// The events table: an AdminTable that shows every row it is given (`pageSize={0}`, the server sends the page) and the
// design system's Pagination under it, controlled by `?page=` (the Audit Log pages through the data layer's
// cursor, so the table holds one page and the address holds which).

export interface AuditTableProps {
  readonly caption: string;
  readonly columns: readonly AdminTableColumn[];
  readonly rows: readonly AdminTableRow[];
  readonly emptyState: ReactNode;
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly pageSize: number;
}

export function AuditTable({ caption, columns, rows, emptyState, page, pageCount, total, pageSize }: AuditTableProps) {
  const url = useUrlState();
  return (
    <>
      <AdminTable caption={caption} columns={[...columns]} rows={[...rows]} emptyState={emptyState} pageSize={0} />
      {total > 0 ? (
        <div className={styles.pagination}>
          <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPageChange={(next) => url.update({ page: next > 1 ? String(next) : null }, { keepPage: true })} />
        </div>
      ) : null}
    </>
  );
}
