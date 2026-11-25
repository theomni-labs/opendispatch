// SPDX-License-Identifier: AGPL-3.0-only
// Cases out of 10-minute reach (spec 4.3)

import type { UnmetDemandCase } from '@/lib/types';

/** The contract's default when the setting is unset. */
export const DEFAULT_THRESHOLD_SECONDS = 600;

export const UNMET_CAUSES = ['geography', 'people'] as const satisfies readonly UnmetDemandCase['cause'][];
export type UnmetCause = (typeof UNMET_CAUSES)[number];
