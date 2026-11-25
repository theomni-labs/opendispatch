// SPDX-License-Identifier: AGPL-3.0-only
// Experiments card rows; pure, no data layer.

import type { ForecastExperiment } from '@/lib/types';
import type { ExperimentRow } from './types';

/** One experiment as a table row. */
export function experimentRow(e: ForecastExperiment): ExperimentRow {
  return {
    id: e.id,
    kind: e.kind,
    trigger: e.trigger,
    status: e.status,
    model: e.model_version,
    challenger: e.challenger_model ?? null,
    snapshot: e.dataset_snapshot_id ?? null,
    wape: e.metrics.wape ?? null,
    startedAt: e.started_at ?? null,
    illustrative: e.illustrative,
  };
}
