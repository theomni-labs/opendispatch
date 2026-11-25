// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScrollCue } from './ScrollCue';

describe('ScrollCue', () => {
  const widths = { scrollWidth: 0, clientWidth: 0 };
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => widths.scrollWidth });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => widths.clientWidth });
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });
  const twoTables = (
    <ScrollCue>
      <div data-box="a">
        <table>
          <tbody><tr><td>a</td></tr></tbody>
        </table>
      </div>
      <div data-box="b">
        <table>
          <tbody><tr><td>b</td></tr></tbody>
        </table>
      </div>
    </ScrollCue>
  );

  it('marks every table scroller when content is hidden', () => {
    widths.scrollWidth = 800;
    widths.clientWidth = 390;
    const { container } = render(twoTables);
    expect([...container.querySelectorAll('[data-box]')].map((box) => box.getAttribute('data-cue'))).toEqual(['more', 'more']);
  });

  it('marks nothing to scroll when the tables fit', () => {
    widths.scrollWidth = 390;
    widths.clientWidth = 390;
    const { container } = render(twoTables);
    expect([...container.querySelectorAll('[data-box]')].map((box) => box.getAttribute('data-cue'))).toEqual(['none', 'none']);
  });
});
