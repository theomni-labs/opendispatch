// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { gapRowBlocksOf } from './gapRow';

describe('gapRowBlocksOf', () => {
  it('draws one block per run of short intervals, labelled with the worst shortfall as a positive count', () => {
    const blocks = gapRowBlocksOf(new Map([[88, 1], [89, 2], [90, 1], [93, 1]]));
    expect(blocks).toEqual([
      { kind: 'gap', from: 22, to: 22.75, label: '2', tip: '2' },
      { kind: 'gap', from: 23.25, to: 23.5, label: '1', tip: '1' },
    ]);
  });

  it('never draws a surplus or a negative label', () => {
    const blocks = gapRowBlocksOf(new Map([[40, 0], [41, -3], [42, 1]]));
    expect(blocks).toEqual([{ kind: 'gap', from: 10.5, to: 10.75, label: '1', tip: '1' }]);
    expect(blocks.every((b) => Number(b.label) > 0)).toBe(true);
  });

  it('is empty when nothing is short', () => {
    expect(gapRowBlocksOf(new Map())).toEqual([]);
  });
});
