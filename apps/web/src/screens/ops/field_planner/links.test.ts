// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { gapHref } from './links';

describe('gapHref', () => {
  it('opens Gap and Surplus on the same zone and day', () => {
    expect(gapHref('091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a', '2026-09-14')).toBe('/ops/gap-surplus?zone=091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a&date=2026-09-14');
  });
});
