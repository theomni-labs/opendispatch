// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { scopeSplit, type SplitView } from './split';

const base: SplitView = { fieldExpected: 131, remoteExpected: 97, fieldShare: 0.57, ruleSetVersion: 'rs-1', canPreviewDraft: true, activeCount: 3, draftCount: 1, previewRuleCode: 'R-1' };

describe('scopeSplit', () => {
  it('uses the sub-zone sums, rounded so the two parts add to the total', () => {
    const out = scopeSplit(base, { field: 6.6, remote: 5.3 }, null);
    expect([out.fieldExpected, out.remoteExpected]).toEqual([7, 5]);
    expect(out.fieldShare).toBeCloseTo(6.6 / 11.9);
    expect(out.ruleSetVersion).toBe('rs-1');
  });
  it('applies the draft share to the sub-zone total, not the zone figures', () => {
    const out = scopeSplit(base, { field: 6, remote: 6 }, 0.25);
    expect([out.fieldExpected, out.remoteExpected, out.fieldShare]).toEqual([3, 9, 0.25]);
  });
  it('is zero with no cases', () => {
    expect(scopeSplit(base, { field: 0, remote: 0 }, null)).toMatchObject({ fieldExpected: 0, remoteExpected: 0, fieldShare: 0 });
  });
});
