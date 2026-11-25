// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Button as AntButton } from 'antd';
import { useFormat, useLabels } from '../provider';
import { cx } from '../types';
import { IconButton } from './button';
import styles from './pagination.module.css';

export interface PaginationProps {
  /** One-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** With pageSize, the summary reads "11 to 20 of 23"; without, "Page 2 of 3". */
  total?: number | undefined;
  pageSize?: number | undefined;
  pageSizeOptions?: number[] | undefined;
  onPageSizeChange?: ((size: number) => void) | undefined;
  className?: string | undefined;
}

type Slot = number | 'gap-start' | 'gap-end';

/** Up to seven slots: the first and last page, the pages around the current one, and gaps. */
function slots(page: number, count: number): Slot[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  let from = Math.max(2, page - 1);
  let to = Math.min(count - 1, page + 1);
  if (page <= 3) {
    from = 2;
    to = 4;
  } else if (page >= count - 2) {
    from = count - 3;
    to = count - 1;
  }
  const out: Slot[] = [1];
  if (from > 2) out.push('gap-start');
  for (let p = from; p <= to; p += 1) out.push(p);
  if (to < count - 1) out.push('gap-end');
  out.push(count);
  return out;
}

/** A labelled <nav> with a live summary, previous and next buttons, and page buttons (Ant Design buttons). */
export function Pagination({ page, pageCount, onPageChange, total, pageSize, pageSizeOptions, onPageSizeChange, className }: PaginationProps) {
  const label = useLabels();
  const { int } = useFormat();
  const count = Math.max(pageCount, 1);
  const current = Math.min(Math.max(page, 1), count);
  let summary: string;
  if (total !== undefined && pageSize !== undefined) {
    const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
    const to = Math.min(current * pageSize, total);
    summary = label('pagination.range', { from: int(from), to: int(to), total: int(total) });
  } else {
    summary = label('pagination.pageOf', { page: int(current), pages: int(count) });
  }
  const sizes = pageSizeOptions && pageSizeOptions.length > 0 && onPageSizeChange ? pageSizeOptions : null;
  return (
    <nav aria-label={label('pagination.label')} className={cx(styles.root, className)}>
      <div className={styles.start}>
        <span className={styles.summary} aria-live="polite">
          {summary}
        </span>
        {sizes && onPageSizeChange ? (
          <label className={styles.pageSize}>
            <span>{label('pagination.pageSize')}</span>
            <select
              className={styles.select}
              value={String(pageSize ?? sizes[0])}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {sizes.map((size) => (
                <option key={size} value={String(size)}>
                  {int(size)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className={styles.end}>
        <IconButton
          icon={<LeftOutlined aria-hidden="true" aria-label="" className={styles.flip} />}
          label={label('pagination.previous')}
          variant="secondary"
          size="sm"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        />
        <ul className={styles.pages}>
          {slots(current, count).map((slot) =>
            typeof slot === 'number' ? (
              <li key={slot}>
                <AntButton
                  htmlType="button"
                  size="small"
                  type={slot === current ? 'primary' : 'text'}
                  ghost={slot === current}
                  className={styles.page ?? ''}
                  aria-current={slot === current ? 'page' : undefined}
                  aria-label={label('pagination.goToPage', { page: int(slot) })}
                  onClick={() => {
                    if (slot !== current) onPageChange(slot);
                  }}
                >
                  {int(slot)}
                </AntButton>
              </li>
            ) : (
              <li key={slot} className={styles.gap} aria-hidden="true">
                …
              </li>
            ),
          )}
        </ul>
        <span className={styles.compact} aria-hidden="true">
          {label('pagination.compact', { page: int(current), pages: int(count) })}
        </span>
        <IconButton
          icon={<RightOutlined aria-hidden="true" aria-label="" className={styles.flip} />}
          label={label('pagination.next')}
          variant="secondary"
          size="sm"
          disabled={current >= count}
          onClick={() => onPageChange(current + 1)}
        />
      </div>
    </nav>
  );
}
