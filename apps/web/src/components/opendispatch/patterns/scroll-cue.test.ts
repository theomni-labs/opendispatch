// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { scrollCue } from './scroll-cue';

describe('scrollCue', () => {
  it('is none when the table fits', () => {
    expect(scrollCue({ scrollLeft: 0, scrollWidth: 390, clientWidth: 390 })).toBe('none');
    expect(scrollCue({ scrollLeft: 0, scrollWidth: 391, clientWidth: 390 })).toBe('none');
  });

  it('is more while there is content past the inline end', () => {
    expect(scrollCue({ scrollLeft: 0, scrollWidth: 620, clientWidth: 390 })).toBe('more');
    expect(scrollCue({ scrollLeft: 100, scrollWidth: 620, clientWidth: 390 })).toBe('more');
  });

  it('is none once scrolled to the end, in either direction', () => {
    expect(scrollCue({ scrollLeft: 230, scrollWidth: 620, clientWidth: 390 })).toBe('none');
    expect(scrollCue({ scrollLeft: -230, scrollWidth: 620, clientWidth: 390 })).toBe('none');
  });

  it('counts a right-to-left box by how far it has travelled', () => {
    expect(scrollCue({ scrollLeft: -40, scrollWidth: 620, clientWidth: 390 })).toBe('more');
  });
});
