// SPDX-License-Identifier: AGPL-3.0-only
// Links to the companions, same zone and day

export const gapHref = (zoneId: string, date: string): string => `/ops/gap-surplus?${new URLSearchParams({ zone: zoneId, date }).toString()}`;
