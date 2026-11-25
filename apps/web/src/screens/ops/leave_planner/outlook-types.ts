// SPDX-License-Identifier: AGPL-3.0-only
// Client-safe outlook constants; no lib/data import.

export const OUTLOOK_HORIZONS = ['13', '52'] as const;
export type OutlookHorizonParam = (typeof OUTLOOK_HORIZONS)[number];
export type OutlookHorizon = 13 | 52;
export type OutlookStatus = 'grant' | 'normal' | 'restrict';

/** Flagged weeks per table page, as the mockup. */
export const OUTLOOK_PAGE_SIZE = 8;
