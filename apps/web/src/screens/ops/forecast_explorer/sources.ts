// SPDX-License-Identifier: AGPL-3.0-only
// Data sources of the forecast and its actuals.

import type { DataSource, ForecastAccuracy, ForecastRun } from '@/lib/types';

/** The run's own source and every input's. */
export function runSources(run: Pick<ForecastRun, 'data_source' | 'input_data_sources'> | undefined): DataSource[] {
  if (run === undefined) return [];
  return [...new Set<DataSource>([run.data_source, ...(run.input_data_sources ?? [])])];
}

export interface CardSources {
  readonly sources: readonly DataSource[];
  /** Mixed, although not every source is named. */
  readonly mixed: boolean;
}

/** Forecast against actual: the run's and the cases' sources. */
export function accuracySources(acc: Pick<ForecastAccuracy, 'data_source' | 'mixed_sources' | 'run'>, run: Parameters<typeof runSources>[0]): CardSources {
  const known = runSources(run);
  if (acc.run === null) return { sources: [], mixed: false };
  const sources = [...new Set<DataSource>([...known, acc.data_source])];
  return { sources, mixed: acc.mixed_sources || sources.length > 1 };
}
