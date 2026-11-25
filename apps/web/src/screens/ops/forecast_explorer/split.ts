// SPDX-License-Identifier: AGPL-3.0-only
export interface SplitView {
  readonly fieldExpected: number;
  readonly remoteExpected: number;
  readonly fieldShare: number;
  readonly ruleSetVersion: string;
  readonly canPreviewDraft: boolean;
  readonly activeCount: number;
  readonly draftCount: number;
  readonly previewRuleCode: string | null;
}

// Stored sums of one sub-zone and day
export interface SubZoneScope {
  readonly field: number;
  readonly remote: number;
}

// Split of one sub-zone; draft uses the zone share
export function scopeSplit(base: SplitView, scope: SubZoneScope, draftShare: number | null): SplitView {
  const total = scope.field + scope.remote;
  const share = draftShare ?? (total <= 0 ? 0 : scope.field / total);
  const field = Math.round(draftShare === null ? scope.field : total * share);
  return { ...base, fieldExpected: field, remoteExpected: Math.round(total) - field, fieldShare: share };
}
