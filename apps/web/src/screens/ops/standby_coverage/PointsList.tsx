'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { StatusPill } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { cx } from '@/components/opendispatch/cx';
import { isolateLtr } from '@/components/opendispatch/isolateLtr';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import styles from './PointsList.module.css';
import type { CoveragePointRow } from './view';

// Standby points table (#sc-pts)

export interface PointsListProps {
  readonly points: readonly CoveragePointRow[];
  readonly selectedId: string | null;
  readonly limitKm: number | null;
}

export function PointsList({ points, selectedId, limitKm }: PointsListProps) {
  const m = useTranslations('ops.standby_coverage');
  const url = useUrlState();

  const toggle = (id: string) => url.update({ pt: id === selectedId ? null : id });

  return (
    <table className={styles.table}>
      <caption className={styles.caption}>{m('list.title')}</caption>
      <thead>
        <tr>
          <th scope="col">{m('col.point')}</th>
          <th scope="col" className={styles.num}>
            {m('col.agents')}
          </th>
          <th scope="col" className={styles.num}>
            {m('col.covers')}
          </th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => {
          const selected = point.id === selectedId;
          return (
            <tr key={point.id} className={cx(styles.row, selected && styles.selected)}>
              <td>
                <button type="button" className={styles.rowButton} aria-pressed={selected} onClick={() => toggle(point.id)}>
                  <span className={styles.cellMain} translate="no">
                    {point.name}
                  </span>
                  <span className={styles.cellSub} translate="no">
                    {point.reachMinutes === null ? point.code : `${isolateLtr(point.code)} · ${m('pt.minutes', { min: Math.round(point.reachMinutes) })}`}
                    {point.homeKm === null ? null : ` · ${m('pt.km', { km: point.homeKm.toFixed(1) })}`}
                  </span>
                  {point.beyondLimit && limitKm !== null ? <StatusPill status={m('pt.beyond', { km: limitKm })} tone="danger" size="sm" className={styles.beyond} /> : null}
                </button>
              </td>
              <td className={styles.num} translate="no">
                {point.agents}
              </td>
              <td className={styles.num} translate="no">
                {point.coversCount}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
