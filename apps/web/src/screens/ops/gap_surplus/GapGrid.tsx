'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, EmptyState } from '@opendispatch/ui';
import { HeatGrid, type HeatCell } from '@opendispatch/ui/charts';
import { SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import styles from './GapSurplus.module.css';
import type { GridModel } from './view';

// Heat grid (#gs-grid); a cell sets ?cell=

export interface GapGridProps {
  readonly grid: GridModel;
  readonly label: string;
}

function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

// Percent views store the unmet or far share
function formatOf(show: GridModel['show']): (n: number) => string {
  if (show === 'met') return (n) => `${100 - n}%`;
  if (show === 'reach') return (n) => `${n}%`;
  return sign;
}

export function GapGrid({ grid, label }: GapGridProps) {
  const m = useTranslations('ops.gap_surplus');
  const t = useTranslations();
  const url = useUrlState();

  const openCell = (cell: HeatCell) => {
    const index = grid.intervalIndex[cell.row]?.[cell.column];
    const zoneId = grid.zoneIds[cell.row];
    if (index === undefined || zoneId === undefined) return;
    url.update({ cell: `${zoneId}:${String(index)}` }, { keepPage: true, history: 'push' });
  };

  const reset = () => url.update({ city: null, zone: null, cause: null, q: null });

  return (
    <div className={styles.gridStack}>
      {grid.anyVisible ? (
        <HeatGrid
          rows={[...grid.rowLabels]}
          columns={[...grid.columns]}
          values={grid.values.map((row) => [...row])}
          kind={grid.show === 'delta' ? 'signed' : 'scale'}
          tone="danger"
          format={formatOf(grid.show)}
          compact={grid.compact}
          minColWidth={grid.minColWidth}
          label={label}
          onCellSelect={openCell}
        />
      ) : (
        <EmptyState
          compact
          icon={<SearchX />}
          title={m('none.title')}
          description={m('none.desc')}
          action={
            <Button variant="secondary" onClick={reset}>
              {t('common.clearAll')}
            </Button>
          }
        />
      )}
      {grid.show !== 'delta' ? (
        <div className={styles.legend}>
          <span className={styles.key}>
            <i className={`${styles.swatch} ${styles.swatchGap}`} aria-hidden="true" />
            <span>{m(grid.show === 'met' ? 'key.met' : 'key.reach')}</span>
          </span>
        </div>
      ) : (
      <div className={styles.legend}>
        <span className={styles.key}>
          <i className={`${styles.swatch} ${styles.swatchGap}`} aria-hidden="true" />
          <span>{m('key.gap')}</span>
        </span>
        <span className={styles.key}>
          <i className={`${styles.swatch} ${styles.swatchSurplus}`} aria-hidden="true" />
          <span>{m('key.surplus')}</span>
        </span>
        <span className={styles.key}>
          <i className={`${styles.swatch} ${styles.swatchOk}`} aria-hidden="true" />
          <span>{m('key.ok')}</span>
        </span>
      </div>
      )}
    </div>
  );
}
