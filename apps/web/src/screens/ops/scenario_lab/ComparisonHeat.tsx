'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { HeatGrid } from '@opendispatch/ui/charts';
import { useTranslations } from 'next-intl';
import type { HeatView } from './view';

// Before/after heat (#sc2-heat), client

export interface ComparisonHeatProps {
  readonly heat: HeatView;
  readonly label: string;
}

function sign(n: number): string {
  return n > 0 ? `+${String(n)}` : String(n);
}

export function ComparisonHeat({ heat, label }: ComparisonHeatProps) {
  const m = useTranslations('ops.scenario_lab');
  // Rows alternate before, after per zone.
  const rows = heat.rows.map((code, index) => `${code} · ${m(index % 2 === 0 ? 'before' : 'after')}`);
  return (
    <HeatGrid
      rows={rows}
      columns={[...heat.columns]}
      values={heat.values.map((r) => [...r])}
      kind="signed"
      format={sign}
      minColWidth={44}
      label={label}
    />
  );
}
