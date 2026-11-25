// SPDX-License-Identifier: AGPL-3.0-only
// Client-safe vocabulary (no lib/data)

export const CLOCK_VALUES = ['a', 'r'] as const;
export type ClockValue = (typeof CLOCK_VALUES)[number];

export const CASES_FILTER_VALUES = ['hi', 'lo'] as const;
export type CasesFilterValue = (typeof CASES_FILTER_VALUES)[number];

export const SPEED_FILTER_VALUES = ['fast', 'slow'] as const;
export type SpeedFilterValue = (typeof SPEED_FILTER_VALUES)[number];

export const SORT_COLUMNS = ['name', 'zone', 'cases', 'a', 'r', 's', 'u'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

// Cases cutoff of the "30 or more" chip
export const CASES_CUTOFF = 30;

// Seconds cutoff of the "Under 10 min" chip
export const SPEED_CUTOFF_SECONDS = 600;
