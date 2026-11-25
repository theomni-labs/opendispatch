// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale, readableText } from '@/components/opendispatch/test-utils';
import { CellDrawer } from './CellDrawer';
import { detailKeyOf } from './types';
import type { DrawerDetail } from './view';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/gap-surplus', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

afterEach(cleanup);

const target: DrawerDetail = {
  zoneName: 'Riyadh North',
  zoneCode: 'RD-N',
  rangeLabel: '08:00–08:15',
  kind: 'gap',
  required: 5,
  planned: 2,
  delta: -3,
  cause: 'people',
  causeDetailEn: '3 more agents needed.',
  reachLabel: null,
  targetLabel: null,
  metLabel: '40%',
  outLabel: null,
  linkHref: null,
  linkIsStandby: false,
  basis: null,
};

describe('Gap and Surplus cell drawer cause line', () => {
  it('is written in the reader language from the numbers', () => {
    inLocale('en', <CellDrawer target={target} />, { module: 'ops.gap_surplus' });
    expect(screen.getByText('Agents short by 3')).toBeTruthy();
    cleanup();
    inLocale('ar', <CellDrawer target={target} />, { module: 'ops.gap_surplus' });
    expect(screen.getByText('نقص في المندوبين بمقدار 3')).toBeTruthy();
    expect(hasLatinLetters(readableText(document.body), [target.zoneName, target.rangeLabel])).toBe(false);
  });

  it('detailKeyOf picks one of the five lines', () => {
    expect(detailKeyOf('balanced', null)).toBe('detail.ok');
    expect(detailKeyOf('surplus', 'people')).toBe('detail.surplus.people');
    expect(detailKeyOf('gap', 'vehicles')).toBe('detail.gap.vehicles');
    expect(detailKeyOf('gap', 'geography')).toBe('detail.gap.geography');
    expect(detailKeyOf('gap', 'people')).toBe('detail.gap.people');
  });
});
