// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_MODULE_IDS, MODULES } from '@/lib/access';
import { SKELETON_SHAPE_NAMES, SKELETON_SHAPES, ScreenSkeleton, skeletonShapeOf } from './ScreenSkeleton';
import { inLocale } from './test-utils';

afterEach(cleanup);

describe('ScreenSkeleton shapes', () => {
  it('has four shapes', () => {
    expect([...SKELETON_SHAPE_NAMES]).toEqual(['list', 'cards', 'form', 'detail']);
  });

  it.each(SKELETON_SHAPE_NAMES)('%s: busy, and "Loading" announced exactly once, with and without a title', (shape) => {
    for (const showTitle of [true, false]) {
      const { container } = inLocale('en', <ScreenSkeleton shape={shape} showTitle={showTitle} />);
      expect(container.querySelector('[aria-busy="true"]'), `${shape} ${showTitle}`).not.toBeNull();
      expect(screen.getAllByText('Loading'), `${shape} ${showTitle}`).toHaveLength(1);
      // Skeletons are shapes only: no text, no button, no link.
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
      cleanup();
    }
  });

  it.each(SKELETON_SHAPE_NAMES)('%s: announces in Arabic', (shape) => {
    inLocale('ar', <ScreenSkeleton shape={shape} />);
    expect(screen.getAllByText('جارٍ التحميل')).toHaveLength(1);
  });

  it.each(SKELETON_SHAPE_NAMES)('%s: a known title is a real h1, not a shimmer bar, and "Loading" still announces once', (shape) => {
    inLocale('en', <ScreenSkeleton shape={shape} title="Forecast and Model Admin" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Forecast and Model Admin' })).toBeTruthy();
    expect(screen.getAllByText('Loading')).toHaveLength(1);
  });

  it('draws a different picture for each shape', () => {
    const pictures = SKELETON_SHAPE_NAMES.map((shape) => {
      const { container } = inLocale('en', <ScreenSkeleton shape={shape} showTitle={false} />);
      const html = container.innerHTML.replace(/_[A-Za-z0-9-]+_[a-z0-9]+/g, '');
      cleanup();
      return html;
    });
    expect(new Set(pictures).size).toBe(4);
  });

  it('list is a card of six rows and cards is four cards, as the mockups draw them', () => {
    // A round skeleton is the mark of a row; a card is the design system Card with large padding.
    const list = inLocale('en', <ScreenSkeleton shape="list" showTitle={false} />);
    expect(list.container.querySelectorAll('[class*="full"]')).toHaveLength(6);
    expect(list.container.querySelectorAll('[class*="padLg"]')).toHaveLength(1);
    cleanup();
    const cards = inLocale('en', <ScreenSkeleton shape="cards" showTitle={false} />);
    expect(cards.container.querySelectorAll('[class*="padLg"]')).toHaveLength(4);
  });
});

describe('skeletonShapeOf', () => {
  it('has a shape for each of the 17 Admin modules', () => {
    expect(Object.keys(SKELETON_SHAPES).sort()).toEqual([...ADMIN_MODULE_IDS].sort());
    for (const id of ADMIN_MODULE_IDS) expect(SKELETON_SHAPE_NAMES, id).toContain(skeletonShapeOf(id));
  });

  it('uses each of the four shapes at least once, or documents why one waits', () => {
    const used = new Set(ADMIN_MODULE_IDS.map(skeletonShapeOf));
    // `form` is Localization; `cards` are the pages of separate cards; `detail` the single-record pages; `list` the rest.
    expect([...used].sort()).toEqual(['cards', 'detail', 'form', 'list']);
  });

  it('is the generic detail shape for an Ops module, an unknown id and none', () => {
    for (const m of MODULES.filter((m) => m.console === 'ops')) expect(skeletonShapeOf(m.id), m.id).toBe('detail');
    expect(skeletonShapeOf(undefined)).toBe('detail');
    expect(skeletonShapeOf('admin.nope' as never)).toBe('detail');
    expect(skeletonShapeOf('constructor' as never)).toBe('detail');
  });
});
